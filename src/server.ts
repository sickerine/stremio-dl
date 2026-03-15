import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import pc from "picocolors";
import { getSeriesMeta, getSeasons, getEpisodesForSeason, searchSeries, searchMovies } from "./api/cinemeta.js";
import { resolveDownloadPlan, formatPlanSummary } from "./core/resolver.js";
import { executeDownload, type DownloadBackend } from "./core/downloader.js";
import { config } from "./config.js";

// ── Job Management ─────────────────────────────────────────────────────────

export interface DownloadJob {
  id: string;
  imdbId: string;
  seriesName: string;
  season: number;
  quality: string;
  backend: DownloadBackend;
  status: "queued" | "resolving" | "downloading" | "completed" | "failed";
  progress: number;
  totalEpisodes: number;
  resolvedEpisodes: number;
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
  const meta = await getSeriesMeta(imdbId);
  const seasons = getSeasons(meta);
  const seasonDetails = seasons.map((s) => ({
    number: s,
    episodes: getEpisodesForSeason(meta, s).map((ep) => ({
      id: ep.id,
      episode: ep.episode,
      name: ep.name,
      released: ep.released,
    })),
  }));

  json(res, {
    id: meta.id,
    name: meta.name,
    year: meta.releaseInfo,
    poster: meta.poster,
    description: meta.description,
    imdbRating: meta.imdbRating,
    seasons: seasonDetails,
  });
}

async function handleDownload(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const body = JSON.parse(await readBody(req)) as {
    imdbId: string;
    season: number;
    quality?: string;
    backend?: DownloadBackend;
    episodes?: number[];
    exclude?: string[];
  };

  if (!body.imdbId || !body.season) {
    return error(res, "Missing imdbId or season");
  }

  const quality = body.quality ?? (config.get("download.preferredQuality") as string);
  const backend = body.backend ?? (config.get("debrid.apiKey") as string ? "debrid" : "direct");

  const jobId = randomUUID();
  const job: DownloadJob = {
    id: jobId,
    imdbId: body.imdbId,
    seriesName: "",
    season: body.season,
    quality,
    backend,
    status: "queued",
    progress: 0,
    totalEpisodes: 0,
    resolvedEpisodes: 0,
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  json(res, { jobId, status: "queued" }, 201);

  runJob(job, body.episodes, body.exclude).catch((err) => {
    job.status = "failed";
    job.error = String(err);
  });
}

async function runJob(job: DownloadJob, episodeFilter?: number[], excludes: string[] = []): Promise<void> {
  try {
    job.status = "resolving";
    const meta = await getSeriesMeta(job.imdbId);
    job.seriesName = meta.name;

    let episodes = getEpisodesForSeason(meta, job.season);
    job.totalEpisodes = episodes.length;

    if (episodeFilter && episodeFilter.length > 0) {
      episodes = episodes.filter((ep) => episodeFilter.includes(ep.episode));
      job.totalEpisodes = episodes.length;
    }

    const plan = await resolveDownloadPlan(meta, job.season, episodes, job.quality, (done, total) => {
      job.resolvedEpisodes = done;
      job.progress = Math.round((done / total) * 30);
    }, excludes);

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
    job.progress = 30;

    console.log(pc.blue(`[Job ${job.id.substring(0, 8)}] Downloading ${job.seriesName} S${String(job.season).padStart(2, "0")}`));
    console.log(formatPlanSummary(plan));

    const outputDir = await executeDownload(plan, job.backend);
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
        types: ["series"],
        idPrefixes: ["tt"],
      },
    ],
    types: ["series"],
    catalogs: [],
    idPrefixes: ["tt"],
    behaviorHints: { configurable: false },
  });
}

// ── Stremio Addon: Stream ─────────────────────────────────────────────────

async function handleAddonStream(id: string, port: number, res: ServerResponse): Promise<void> {
  // id format: "tt0903747:1:1" (imdbId:season:episode)
  const parts = id.replace(".json", "").split(":");
  const imdbId = parts[0];
  const season = parseInt(parts[1] ?? "0", 10);

  if (!imdbId || !season) {
    json(res, { streams: [] });
    return;
  }

  const base = `http://127.0.0.1:${port}`;
  const ep = parts[2] ?? "1";

  json(res, {
    streams: [
      {
        name: "DL Season\n1080p",
        description: `S${String(season).padStart(2, "0")} | 1080p | No 60fps`,
        externalUrl: `${base}/ui/trigger/${imdbId}/${season}?quality=1080p&exclude=60fps`,
      },
      {
        name: "DL Season\n4K",
        description: `S${String(season).padStart(2, "0")} | 4K/2160p`,
        externalUrl: `${base}/ui/trigger/${imdbId}/${season}?quality=2160p`,
      },
      {
        name: "DL Episode\n1080p",
        description: `E${String(ep).padStart(2, "0")} | 1080p | No 60fps`,
        externalUrl: `${base}/ui/trigger/${imdbId}/${season}/${ep}?quality=1080p&exclude=60fps`,
      },
      {
        name: "DL Episode\n4K",
        description: `E${String(ep).padStart(2, "0")} | 4K/2160p`,
        externalUrl: `${base}/ui/trigger/${imdbId}/${season}/${ep}?quality=2160p`,
      },
    ],
  });
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
  const backend = (config.get("debrid.apiKey") as string) ? "debrid" : "direct";

  const jobId = randomUUID();
  const job: DownloadJob = {
    id: jobId,
    imdbId,
    seriesName: "",
    season,
    quality,
    backend,
    status: "queued",
    progress: 0,
    totalEpisodes: 0,
    resolvedEpisodes: 0,
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);

  const episodeFilter = episode !== null ? [episode] : undefined;
  runJob(job, episodeFilter, excludes).catch((err) => {
    job.status = "failed";
    job.error = String(err);
  });

  // Redirect to status page
  res.writeHead(302, { Location: `/ui/status/${jobId}` });
  res.end();
}

function handleStatusPage(jobId: string, _port: number, res: ServerResponse): void {
  html(res, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stremio DL</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a1a; color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; padding: 20px;
    }
    .card {
      background: #1a1a2e; border-radius: 16px; padding: 32px;
      max-width: 480px; width: 100%;
      box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    }
    h1 { font-size: 20px; margin-bottom: 4px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 24px; }
    .progress-track {
      height: 8px; background: #333; border-radius: 4px;
      overflow: hidden; margin-bottom: 12px;
    }
    .progress-bar {
      height: 100%; border-radius: 4px;
      transition: width 0.5s ease, background 0.3s;
    }
    .progress-bar.resolving { background: #f5a623; }
    .progress-bar.downloading { background: #7b5bf5; }
    .progress-bar.completed { background: #4caf50; }
    .progress-bar.failed { background: #e04b4b; }
    .status-row {
      display: flex; justify-content: space-between;
      font-size: 13px; color: #aaa; margin-bottom: 8px;
    }
    .status-label {
      display: inline-flex; align-items: center; gap: 6px;
    }
    .dot {
      width: 8px; height: 8px; border-radius: 50%;
    }
    .dot.queued { background: #888; }
    .dot.resolving { background: #f5a623; }
    .dot.downloading { background: #7b5bf5; }
    .dot.completed { background: #4caf50; }
    .dot.failed { background: #e04b4b; }
    .error { color: #e04b4b; font-size: 13px; margin-top: 8px; }
    .output { color: #4caf50; font-size: 13px; margin-top: 8px; word-break: break-all; }
    .back {
      display: inline-block; margin-top: 20px;
      color: #7b5bf5; text-decoration: none; font-size: 13px;
    }
    .back:hover { text-decoration: underline; }
    .jobs-link { margin-top: 12px; }
  </style>
</head>
<body>
  <div class="card">
    <h1 id="title">Starting download...</h1>
    <div class="subtitle" id="subtitle">Initializing</div>
    <div class="progress-track">
      <div class="progress-bar" id="bar" style="width:0%"></div>
    </div>
    <div class="status-row">
      <span class="status-label"><span class="dot" id="dot"></span><span id="status">queued</span></span>
      <span id="percent">0%</span>
    </div>
    <div id="extra"></div>
    <a href="/ui/jobs" class="back jobs-link">View all downloads</a>
  </div>
  <script>
    const jobId = "${jobId}";
    async function poll() {
      try {
        const res = await fetch("/api/jobs/" + jobId);
        const job = await res.json();
        document.getElementById("title").textContent = (job.seriesName || job.imdbId) + " S" + String(job.season).padStart(2, "0");
        document.getElementById("subtitle").textContent = job.quality + " | " + job.backend + " | " + job.totalEpisodes + " episodes";
        document.getElementById("bar").style.width = job.progress + "%";
        document.getElementById("bar").className = "progress-bar " + job.status;
        document.getElementById("dot").className = "dot " + job.status;
        document.getElementById("status").textContent = job.status;
        document.getElementById("percent").textContent = job.progress + "%";
        if (job.error) {
          document.getElementById("extra").innerHTML = '<div class="error">' + job.error + '</div>';
        } else if (job.outputDir) {
          document.getElementById("extra").innerHTML = '<div class="output">Saved to: ' + job.outputDir + '</div>';
        }
        if (job.status !== "completed" && job.status !== "failed") {
          setTimeout(poll, 1500);
        }
      } catch { setTimeout(poll, 3000); }
    }
    poll();
  </script>
</body>
</html>`);
}

function handleJobsPage(port: number, res: ServerResponse): void {
  html(res, `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stremio DL - Downloads</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a1a; color: #e0e0e0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      padding: 32px; max-width: 640px; margin: 0 auto;
    }
    h1 { font-size: 24px; margin-bottom: 24px; color: #fff; }
    .empty { color: #666; text-align: center; padding: 48px; }
    .job {
      background: #1a1a2e; border-radius: 12px; padding: 16px;
      margin-bottom: 12px;
    }
    .job-title { font-size: 15px; font-weight: 600; color: #fff; margin-bottom: 4px; }
    .job-meta { font-size: 12px; color: #888; margin-bottom: 8px; }
    .progress-track {
      height: 6px; background: #333; border-radius: 3px;
      overflow: hidden; margin-bottom: 6px;
    }
    .progress-bar { height: 100%; border-radius: 3px; transition: width 0.5s; }
    .progress-bar.resolving { background: #f5a623; }
    .progress-bar.downloading { background: #7b5bf5; }
    .progress-bar.completed { background: #4caf50; }
    .progress-bar.failed { background: #e04b4b; }
    .job-footer {
      display: flex; justify-content: space-between;
      font-size: 12px; color: #aaa;
    }
    .dot {
      width: 6px; height: 6px; border-radius: 50%;
      display: inline-block; margin-right: 4px;
    }
    .dot.queued { background: #888; }
    .dot.resolving { background: #f5a623; }
    .dot.downloading { background: #7b5bf5; }
    .dot.completed { background: #4caf50; }
    .dot.failed { background: #e04b4b; }
    .install-info {
      background: #1a1a2e; border-radius: 12px; padding: 16px;
      margin-bottom: 24px; font-size: 13px; color: #aaa;
    }
    .install-info code {
      background: #222; padding: 2px 6px; border-radius: 4px;
      color: #7b5bf5; font-size: 12px;
    }
  </style>
</head>
<body>
  <h1>Stremio Downloads</h1>
  <div class="install-info">
    Install addon in Stremio: <code>http://localhost:${port}/manifest.json</code>
  </div>
  <div id="list"><div class="empty">Loading...</div></div>
  <script>
    async function poll() {
      try {
        const res = await fetch("/api/jobs");
        const data = await res.json();
        const el = document.getElementById("list");
        if (!data.jobs || data.jobs.length === 0) {
          el.innerHTML = '<div class="empty">No downloads yet. Use Stremio to start a download.</div>';
        } else {
          el.innerHTML = data.jobs.map(j => \`
            <div class="job">
              <div class="job-title">\${j.seriesName || j.imdbId} S\${String(j.season).padStart(2,"0")}</div>
              <div class="job-meta">\${j.quality} | \${j.backend} | \${j.totalEpisodes} eps</div>
              <div class="progress-track">
                <div class="progress-bar \${j.status}" style="width:\${j.progress}%"></div>
              </div>
              <div class="job-footer">
                <span><span class="dot \${j.status}"></span>\${j.status}\${j.error ? ": " + j.error.substring(0, 60) : ""}</span>
                <span>\${j.progress}%</span>
              </div>
              \${j.outputDir ? '<div style="font-size:11px;color:#4caf50;margin-top:6px">'+j.outputDir+'</div>' : ''}
            </div>
          \`).join("");
        }
      } catch { }
      setTimeout(poll, 2000);
    }
    poll();
  </script>
</body>
</html>`);
}

// ── Server ─────────────────────────────────────────────────────────────────

export function startServer(port: number): void {
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
      } else if (method === "GET" && path.startsWith("/stream/series/")) {
        const id = path.replace("/stream/series/", "").replace(".json", "");
        await handleAddonStream(id, port, res);
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
        handleStatusPage(jobId, port, res);
      } else if (method === "GET" && path === "/ui/jobs") {
        handleJobsPage(port, res);
      }
      // ── REST API ────────────────────────────────────────────────────
      else if (method === "GET" && path === "/api/search") {
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
  });
}
