import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { exec } from "node:child_process";
import pc from "picocolors";
import { getMeta, getSeriesMeta, getSeasons, getEpisodesForSeason, searchSeries, searchMovies } from "./api/cinemeta.js";
import { resolveDownloadPlan, resolveMovieDownloadPlan, formatPlanSummary } from "./core/resolver.js";
import type { SeriesMeta, MovieMeta } from "./types.js";
import { executeDownload, type DownloadBackend } from "./core/downloader.js";
import { config } from "./config.js";

// ── Job Management ─────────────────────────────────────────────────────────

export interface EpisodeProgress {
  episode: number;
  filename: string;
  status: "pending" | "downloading" | "completed" | "failed";
  percent: number;
  downloadedMB: number;
  totalMB: number;
  speedMBps: number;
}

export interface DownloadJob {
  id: string;
  imdbId: string;
  contentType: "movie" | "series";
  seriesName: string;
  season: number;
  quality: string;
  backend: DownloadBackend;
  status: "queued" | "resolving" | "downloading" | "completed" | "failed";
  progress: number;
  totalSpeedMBps: number;
  totalEpisodes: number;
  resolvedEpisodes: number;
  episodeProgress: EpisodeProgress[];
  error?: string;
  outputDir?: string;
  createdAt: string;
  completedAt?: string;
}

const jobs = new Map<string, DownloadJob>();

// ── HTTP Helpers ───────────────────────────────────────────────────────────

function cors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function html(res: ServerResponse, body: string, status = 200): void {
  cors(res);
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(body);
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
}

function parseUrl(url: string): { path: string; query: URLSearchParams } {
  const parsed = new URL(url, "http://localhost");
  return { path: decodeURIComponent(parsed.pathname), query: parsed.searchParams };
}

// ── API Route Handlers ────────────────────────────────────────────────────

async function handleSearch(query: URLSearchParams, res: ServerResponse): Promise<void> {
  const q = query.get("q");
  if (!q) return error(res, "Missing query parameter ?q=");

  const type = query.get("type") ?? "all";
  const results = [];

  if (type === "all" || type === "series") {
    const sr = await searchSeries(q);
    results.push(...sr.metas);
  }
  if (type === "all" || type === "movie") {
    const mr = await searchMovies(q);
    results.push(...mr.metas);
  }

  json(res, { results });
}

async function handleMeta(imdbId: string, res: ServerResponse): Promise<void> {
  const meta = await getMeta(imdbId);

  if (meta.type === "movie") {
    json(res, {
      id: meta.id,
      type: "movie",
      name: meta.name,
      year: meta.releaseInfo,
      poster: meta.poster,
      description: meta.description,
      imdbRating: meta.imdbRating,
      seasons: [],
    });
    return;
  }

  const seriesMeta = meta as SeriesMeta;
  const seasons = getSeasons(seriesMeta);
  const seasonDetails = seasons.map((s) => ({
    number: s,
    episodes: getEpisodesForSeason(seriesMeta, s).map((ep) => ({
      id: ep.id,
      episode: ep.episode,
      name: ep.name,
      released: ep.released,
    })),
  }));

  json(res, {
    id: meta.id,
    type: "series",
    name: meta.name,
    year: meta.releaseInfo,
    poster: meta.poster,
    description: meta.description,
    imdbRating: meta.imdbRating,
    seasons: seasonDetails,
  });
}

function formatSize(bytes: number): string {
  if (bytes >= 1_073_741_824) return (bytes / 1_073_741_824).toFixed(1) + " GB";
  if (bytes >= 1_048_576) return (bytes / 1_048_576).toFixed(0) + " MB";
  return bytes + " B";
}

async function handleEstimate(query: URLSearchParams, res: ServerResponse): Promise<void> {
  const imdbId = query.get("imdbId");
  const seasonNum = parseInt(query.get("season") ?? "0", 10);
  const contentType = query.get("type") ?? "series";
  const quality = query.get("quality") ?? "1080p";
  const excludeRaw = query.get("exclude") ?? "";
  const excludes = excludeRaw ? excludeRaw.split(",") : [];
  const requireRaw = query.get("require") ?? "";
  const requires = requireRaw ? requireRaw.split(",") : [];

  if (!imdbId) return error(res, "Missing imdbId");

  let plan;
  let totalEpCount: number;

  if (contentType === "movie") {
    const meta = await getMeta(imdbId) as MovieMeta;
    plan = await resolveMovieDownloadPlan(meta, quality, excludes, requires);
    totalEpCount = 1;
  } else {
    if (!seasonNum) return error(res, "Missing season");
    const meta = await getSeriesMeta(imdbId);
    const episodes = getEpisodesForSeason(meta, seasonNum);
    if (episodes.length === 0) return json(res, { episodes: 0, totalBytes: 0, totalFormatted: "0 MB", breakdown: [] });
    plan = await resolveDownloadPlan(meta, seasonNum, episodes, quality, undefined, excludes, requires);
    totalEpCount = episodes.length;
  }

  const allEps = [...plan.packs.flatMap((p) => p.episodes), ...plan.individual]
    .sort((a, b) => a.episodeNumber - b.episodeNumber);

  if (allEps.length === 0) return json(res, { episodes: 0, totalBytes: 0, totalFormatted: "0 MB", breakdown: [] });

  let totalBytes = 0;
  const headPromises = allEps.map(async (ep) => {
    const filename = ep.stream.behaviorHints?.filename ?? (plan.type === "movie" ? `${plan.meta.name}.mkv` : `S${String(ep.seasonNumber).padStart(2, "0")}E${String(ep.episodeNumber).padStart(2, "0")}.mkv`);
    let bytes = 0;
    if (ep.stream.url) {
      try {
        const headRes = await fetch(ep.stream.url, { method: "HEAD", redirect: "follow" });
        const cl = headRes.headers.get("content-length");
        if (cl) bytes = parseInt(cl, 10);
      } catch { /* skip */ }
    }
    return { episode: ep.episodeNumber, name: ep.video.name, filename, bytes, size: formatSize(bytes) };
  });

  const results = await Promise.all(headPromises);
  for (const r of results.sort((a, b) => a.episode - b.episode)) {
    totalBytes += r.bytes;
  }

  json(res, {
    episodes: allEps.length,
    totalEpisodes: totalEpCount,
    resolved: allEps.length,
    totalBytes,
    totalFormatted: formatSize(totalBytes),
    quality,
    breakdown: results.sort((a, b) => a.episode - b.episode),
  });
}

async function handleDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as {
    imdbId: string;
    type?: "movie" | "series";
    season?: number;
    quality?: string;
    backend?: DownloadBackend;
    episodes?: number[];
    exclude?: string[];
    require?: string[];
  };

  if (!body.imdbId) {
    return error(res, "Missing imdbId");
  }
  if (body.type !== "movie" && !body.season) {
    return error(res, "Missing season for series download");
  }

  const quality = body.quality ?? (config.get("download.preferredQuality") as string);
  const backend = body.backend ?? (config.get("debrid.apiKey") as string ? "debrid" : "direct");

  const jobId = randomUUID();
  const job: DownloadJob = {
    id: jobId,
    imdbId: body.imdbId,
    contentType: body.type ?? "series",
    seriesName: "",
    season: body.season ?? 0,
    quality,
    backend,
    status: "queued",
    progress: 0,
    totalSpeedMBps: 0,
    totalEpisodes: 0,
    resolvedEpisodes: 0,
    episodeProgress: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  json(res, { jobId, status: "queued" }, 201);

  runJob(job, body.episodes, body.exclude, body.require).catch((err) => {
    job.status = "failed";
    job.error = String(err);
  });
}

async function runJob(job: DownloadJob, episodeFilter?: number[], excludes: string[] = [], requires: string[] = []): Promise<void> {
  try {
    job.status = "resolving";
    const meta = await getMeta(job.imdbId);
    job.seriesName = meta.name;

    let plan;

    if (job.contentType === "movie" || meta.type === "movie") {
      job.contentType = "movie";
      job.totalEpisodes = 1;
      plan = await resolveMovieDownloadPlan(meta as MovieMeta, job.quality, excludes, requires);
    } else {
      const seriesMeta = meta as SeriesMeta;
      let episodes = getEpisodesForSeason(seriesMeta, job.season);
      job.totalEpisodes = episodes.length;

      if (episodeFilter && episodeFilter.length > 0) {
        episodes = episodes.filter((ep) => episodeFilter.includes(ep.episode));
        job.totalEpisodes = episodes.length;
      }

      plan = await resolveDownloadPlan(seriesMeta, job.season, episodes, job.quality, (done, _total) => {
        job.resolvedEpisodes = done;
      }, excludes, requires);
    }

    const resolvedCount = plan.packs.reduce((sum, p) => sum + p.episodes.length, 0) + plan.individual.length;
    if (resolvedCount === 0) {
      job.status = "failed";
      job.error = "No streams found";
      return;
    }

    if (plan.hasDirectUrls && job.backend !== "qbittorrent") {
      job.backend = "direct";
    }

    job.status = "downloading";
    job.progress = 0;

    const label = job.contentType === "movie" ? job.seriesName : `${job.seriesName} S${String(job.season).padStart(2, "0")}`;
    console.log(pc.blue(`[Job ${job.id.substring(0, 8)}] Downloading ${label}`));
    console.log(formatPlanSummary(plan));

    const outputDir = await executeDownload(plan, job.backend, (files) => {
      job.episodeProgress = files.map((f) => ({
        episode: f.index + 1,
        filename: f.filename,
        status: f.status,
        percent: f.percent,
        downloadedMB: f.downloadedMB,
        totalMB: f.totalMB,
        speedMBps: f.speedMBps,
      }));
      const totalFiles = files.length;
      const fileProgress = files.reduce((sum, f) => sum + (f.status === "completed" ? 100 : f.percent), 0) / totalFiles;
      job.progress = Math.round(fileProgress);
      job.totalSpeedMBps = files.reduce((sum, f) => sum + (f.status === "downloading" ? f.speedMBps : 0), 0);
    });
    job.outputDir = outputDir;
    job.status = "completed";
    job.progress = 100;
    job.completedAt = new Date().toISOString();

    console.log(pc.green(`[Job ${job.id.substring(0, 8)}] Complete: ${outputDir}`));
  } catch (err) {
    job.status = "failed";
    job.error = String(err);
    console.error(pc.red(`[Job ${job.id.substring(0, 8)}] Failed: ${err}`));
  }
}

function handleJobs(res: ServerResponse): void {
  const allJobs = [...jobs.values()].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  json(res, { jobs: allJobs });
}

function handleJobStatus(jobId: string, res: ServerResponse): void {
  const job = jobs.get(jobId);
  if (!job) return error(res, "Job not found", 404);
  json(res, job);
}

function handleJobDelete(jobId: string, res: ServerResponse): void {
  if (!jobs.has(jobId)) return error(res, "Job not found", 404);
  jobs.delete(jobId);
  json(res, { deleted: true });
}

function handleConfig(res: ServerResponse): void {
  const addonUrl = config.get("addons.streamUrl") as string;
  const isStremThru = addonUrl.includes("/stremio/wrap/") || addonUrl.includes("/stremio/store/");
  json(res, {
    addonUrl,
    isStremThru,
    quality: config.get("download.preferredQuality"),
    outputDir: config.get("download.outputDir"),
    maxConcurrent: config.get("download.maxConcurrent"),
  });
}

async function handlePickFolder(res: ServerResponse): Promise<void> {
  const { execSync } = await import("node:child_process");
  let folder = "";
  try {
    if (process.platform === "darwin") {
      const result = execSync(
        `osascript -e 'POSIX path of (choose folder with prompt "Select download folder")'`,
        { encoding: "utf-8", timeout: 60_000 },
      ).trim();
      folder = result;
    } else if (process.platform === "win32") {
      const result = execSync(
        `powershell -Command "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select download folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath }"`,
        { encoding: "utf-8", timeout: 60_000 },
      ).trim();
      folder = result;
    } else {
      const result = execSync(
        `zenity --file-selection --directory --title="Select download folder" 2>/dev/null || kdialog --getexistingdirectory ~ 2>/dev/null`,
        { encoding: "utf-8", timeout: 60_000 },
      ).trim();
      folder = result;
    }
  } catch {
    return json(res, { folder: "" });
  }
  if (folder) {
    config.set("download.outputDir", folder);
  }
  json(res, { folder });
}

// ── Stremio Addon: Manifest ───────────────────────────────────────────────

function handleManifest(_port: number, res: ServerResponse): void {
  json(res, {
    id: "com.stremiodl.downloader",
    version: "1.0.0",
    name: "Stremio Downloader",
    description: "Download entire seasons to your computer",
    resources: [
      {
        name: "stream",
        types: ["movie", "series"],
        idPrefixes: ["tt"],
      },
    ],
    types: ["movie", "series"],
    catalogs: [],
    idPrefixes: ["tt"],
    behaviorHints: { configurable: false },
  });
}

// ── Stremio Addon: Stream ─────────────────────────────────────────────────

async function handleAddonStream(id: string, type: "movie" | "series", port: number, res: ServerResponse): Promise<void> {
  const parts = id.replace(".json", "").split(":");
  const imdbId = parts[0];
  const base = `http://127.0.0.1:${port}`;

  if (!imdbId) {
    json(res, { streams: [] });
    return;
  }

  if (type === "movie") {
    json(res, {
      streams: [{
        name: "Stremio DL",
        description: "Download Movie",
        externalUrl: `${base}/?download=${imdbId}&type=movie`,
      }],
    });
  } else {
    const season = parseInt(parts[1] ?? "0", 10);
    if (!season) {
      json(res, { streams: [] });
      return;
    }
    json(res, {
      streams: [{
        name: "Stremio DL",
        description: `Download Season ${season}`,
        externalUrl: `${base}/?download=${imdbId}&season=${season}`,
      }],
    });
  }
}

// ── Trigger UI ─────────────────────────────────────────────────────────────

async function handleTrigger(
  imdbId: string,
  season: number,
  episode: number | null,
  query: URLSearchParams,
  res: ServerResponse,
): Promise<void> {
  const quality = query.get("quality") ?? (config.get("download.preferredQuality") as string);
  const excludeRaw = query.get("exclude") ?? "";
  const excludes = excludeRaw ? excludeRaw.split(",") : [];
  const requireRaw = query.get("require") ?? "";
  const requires = requireRaw ? requireRaw.split(",") : [];
  const backend = (config.get("debrid.apiKey") as string) ? "debrid" : "direct";

  const contentType: "movie" | "series" = season === 0 ? "movie" : "series";
  const jobId = randomUUID();
  const job: DownloadJob = {
    id: jobId,
    imdbId,
    contentType,
    seriesName: "",
    season,
    quality,
    backend,
    status: "queued",
    progress: 0,
    totalSpeedMBps: 0,
    totalEpisodes: 0,
    resolvedEpisodes: 0,
    episodeProgress: [],
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  const episodeFilter = episode !== null ? [episode] : undefined;
  runJob(job, episodeFilter, excludes, requires).catch((err) => {
    job.status = "failed";
    job.error = String(err);
  });

  // Redirect to main app with job focused
  res.writeHead(302, { Location: `/?job=${jobId}` });
  res.end();
}

// UI assets — imported as text so bun compile embeds them
import uiCss from "./ui/styles.css" with { type: "text" };
import uiJs from "./ui/dist/index.js" with { type: "text" };

function handleAppPage(port: number, res: ServerResponse): void {
  const css = uiCss;
  const js = uiJs;

  html(res, `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stremio DL</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=JetBrains+Mono:wght@400;500;700&family=Space+Grotesk:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>${css}</style></head><body>
<div id="app"></div>
<script>window.__PORT__=${port};</script>
<script>${js}</script>
</body></html>`);
}

// ── Server ─────────────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}

export function startServer(port: number, autoOpen = false): void {
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const { path, query } = parseUrl(rawUrl);

    // Request logging for debugging Stremio addon communication
    const decodedDiffers = rawUrl !== path ? ` (raw: ${rawUrl})` : "";
    console.log(pc.dim(`[${method}] ${path}${decodedDiffers}`));

    // CORS preflight
    if (method === "OPTIONS") {
      cors(res);
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // ── Stremio Addon Protocol ──────────────────────────────────────
      if (method === "GET" && path === "/manifest.json") {
        handleManifest(port, res);
      } else if (method === "GET" && path.startsWith("/stream/movie/")) {
        const id = path.replace("/stream/movie/", "").replace(".json", "");
        await handleAddonStream(id, "movie", port, res);
      } else if (method === "GET" && path.startsWith("/stream/series/")) {
        const id = path.replace("/stream/series/", "").replace(".json", "");
        await handleAddonStream(id, "series", port, res);
      }
      // ── Web UI ──────────────────────────────────────────────────────
      else if (method === "GET" && path.startsWith("/ui/trigger/")) {
        const segments = path.replace("/ui/trigger/", "").split("/");
        const imdbId = segments[0]!;
        const season = parseInt(segments[1] ?? "1", 10);
        const episode = segments[2] ? parseInt(segments[2], 10) : null;
        await handleTrigger(imdbId, season, episode, query, res);
      } else if (method === "GET" && path.startsWith("/ui/status/")) {
        const jobId = path.replace("/ui/status/", "");
        res.writeHead(302, { Location: `/?job=${jobId}` });
        res.end();
      } else if (method === "GET" && (path === "/ui/jobs" || path === "/ui" || path === "/")) {
        handleAppPage(port, res);
      }
      // ── REST API ────────────────────────────────────────────────────
      else if (method === "GET" && path === "/api/estimate") {
        await handleEstimate(query, res);
      } else if (method === "GET" && path === "/api/search") {
        await handleSearch(query, res);
      } else if (method === "GET" && path.startsWith("/api/meta/")) {
        const imdbId = path.split("/api/meta/")[1]!;
        await handleMeta(imdbId, res);
      } else if (method === "POST" && path === "/api/download") {
        await handleDownload(req, res);
      } else if (method === "GET" && path === "/api/jobs") {
        handleJobs(res);
      } else if (method === "GET" && path.startsWith("/api/jobs/")) {
        handleJobStatus(path.split("/api/jobs/")[1]!, res);
      } else if (method === "DELETE" && path.startsWith("/api/jobs/")) {
        handleJobDelete(path.split("/api/jobs/")[1]!, res);
      } else if (method === "GET" && path === "/api/config") {
        handleConfig(res);
      } else if (method === "POST" && path === "/api/pick-folder") {
        await handlePickFolder(res);
      } else if (method === "GET" && path === "/api/health") {
        json(res, { ok: true, version: "1.0.0" });
      }
      // ── Fallback ────────────────────────────────────────────────────
      else {
        error(res, "Not found", 404);
      }
    } catch (err) {
      console.error(pc.red(`[Server] Error: ${err}`));
      error(res, String(err), 500);
    }
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(pc.red(`\nPort ${port} is already in use.`));
      console.error(pc.dim(`Either stop the other process or use a different port:`));
      console.error(pc.dim(`  stremio-dl serve --port 9945\n`));
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(pc.bold(`\nstremio-dl server running on http://localhost:${port}\n`));
    console.log("Stremio Addon:");
    console.log(`  Install in Stremio: ${pc.green(`http://127.0.0.1:${port}/manifest.json`)}`);
    console.log("");
    console.log("Web UI:");
    console.log(`  ${pc.green(`http://localhost:${port}/ui/jobs`)}        Download dashboard`);
    console.log("");
    console.log("REST API:");
    console.log(`  GET  /api/health              Health check`);
    console.log(`  GET  /api/config              Current configuration`);
    console.log(`  GET  /api/search?q=...        Search series/movies`);
    console.log(`  GET  /api/meta/:imdbId        Series metadata + episodes`);
    console.log(`  POST /api/download            Start download job`);
    console.log(`  GET  /api/jobs                List all jobs`);
    console.log(`  GET  /api/jobs/:id            Job status`);
    console.log(`  DELETE /api/jobs/:id          Remove job`);
    console.log(pc.dim(`\nWaiting for requests...\n`));
    if (autoOpen) openBrowser(`http://localhost:${port}`);
  });
}
