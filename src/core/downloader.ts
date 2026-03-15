import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Listr } from "listr2";
import type { DownloadPlan, ResolvedEpisode } from "../types.js";
import * as rd from "../api/real-debrid.js";
import * as qb from "../api/qbittorrent.js";
import { config } from "../config.js";

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function downloadFile(
  url: string,
  outputPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number) => void,
): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  if (!res.body) throw new Error("No response body");

  const totalBytes = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloadedBytes = 0;

  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);

  nodeStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    if (totalBytes > 0) {
      onProgress?.(
        (downloadedBytes / totalBytes) * 100,
        downloadedBytes / 1_048_576,
        totalBytes / 1_048_576,
      );
    }
  });

  await pipeline(nodeStream, createWriteStream(outputPath));
}

function buildOutputDir(plan: DownloadPlan): string {
  const base = config.get("download.outputDir") as string;
  const seriesName = sanitizeFilename(plan.series.name);
  const seasonDir = `Season ${String(plan.season).padStart(2, "0")}`;
  return join(base, seriesName, seasonDir);
}

function buildEpisodeFilename(ep: ResolvedEpisode): string {
  const hint = ep.stream.behaviorHints?.filename;
  if (hint) return sanitizeFilename(hint);

  const name = ep.video.name;
  const sNum = String(ep.seasonNumber).padStart(2, "0");
  const eNum = String(ep.episodeNumber).padStart(2, "0");
  return sanitizeFilename(`S${sNum}E${eNum} - ${name}.mkv`);
}

// ── Direct Download Backend (StremThru / any URL-based streams) ────────────

async function downloadDirect(plan: DownloadPlan): Promise<void> {
  const outputDir = buildOutputDir(plan);
  ensureDir(outputDir);
  const maxConcurrent = config.get("download.maxConcurrent") as number;

  const episodes = plan.individual; // All episodes are individual in direct mode

  if (episodes.length === 0) {
    throw new Error("No episodes with direct URLs to download");
  }

  const tasks = new Listr(
    episodes.map((ep) => {
      const filename = buildEpisodeFilename(ep);
      return {
        title: filename,
        task: async (_ctx: unknown, task: { title: string; output: string }) => {
          const url = ep.stream.url!;
          const outputPath = join(outputDir, filename);
          await downloadFile(url, outputPath, (percent, dlMB, totalMB) => {
            task.output = `${percent.toFixed(1)}% (${dlMB.toFixed(1)}/${totalMB.toFixed(1)} MB)`;
          });
          task.title = `${filename} ✓`;
        },
      };
    }),
    {
      concurrent: maxConcurrent,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  await tasks.run();
}

// ── Real-Debrid Backend ────────────────────────────────────────────────────

async function downloadViaDebrid(plan: DownloadPlan): Promise<void> {
  const outputDir = buildOutputDir(plan);
  ensureDir(outputDir);
  const maxConcurrent = config.get("download.maxConcurrent") as number;

  interface DownloadItem {
    url: string;
    filename: string;
  }
  const items: DownloadItem[] = [];

  // Process season packs — one RD torrent per pack
  for (const pack of plan.packs) {
    const fileIdxs = pack.episodes
      .map((ep) => ep.stream.fileIdx)
      .filter((idx): idx is number => idx !== undefined);

    const results = await rd.getDownloadLinks(
      pack.infoHash,
      fileIdxs.length > 0 ? fileIdxs : undefined,
    );

    for (const result of results) {
      const matchingEp = pack.episodes.find((ep) => {
        const hint = ep.stream.behaviorHints?.filename;
        return hint && result.filename.includes(hint.replace(/\.[^.]+$/, ""));
      });
      items.push({
        url: result.url,
        filename: matchingEp ? buildEpisodeFilename(matchingEp) : sanitizeFilename(result.filename),
      });
    }
  }

  // Process individual episodes
  for (const ep of plan.individual) {
    const fileIdxs = ep.stream.fileIdx !== undefined ? [ep.stream.fileIdx] : undefined;
    const results = await rd.getDownloadLinks(ep.stream.infoHash!, fileIdxs);
    if (results[0]) {
      items.push({
        url: results[0].url,
        filename: buildEpisodeFilename(ep),
      });
    }
  }

  if (items.length === 0) {
    throw new Error("No download links could be resolved");
  }

  const tasks = new Listr(
    items.map((item) => ({
      title: item.filename,
      task: async (_ctx: unknown, task: { title: string; output: string }) => {
        const outputPath = join(outputDir, item.filename);
        await downloadFile(item.url, outputPath, (percent, dlMB, totalMB) => {
          task.output = `${percent.toFixed(1)}% (${dlMB.toFixed(1)}/${totalMB.toFixed(1)} MB)`;
        });
        task.title = `${item.filename} ✓`;
      },
    })),
    {
      concurrent: maxConcurrent,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  await tasks.run();
}

// ── qBittorrent Backend ────────────────────────────────────────────────────

async function downloadViaQBittorrent(plan: DownloadPlan): Promise<void> {
  const outputDir = buildOutputDir(plan);
  ensureDir(outputDir);

  await qb.login();

  const hashesToProcess = new Map<string, number[]>();

  for (const pack of plan.packs) {
    const fileIdxs = pack.episodes
      .map((ep) => ep.stream.fileIdx)
      .filter((idx): idx is number => idx !== undefined);
    hashesToProcess.set(pack.infoHash, fileIdxs);
  }

  for (const ep of plan.individual) {
    const hash = ep.stream.infoHash!;
    const idx = ep.stream.fileIdx;
    hashesToProcess.set(hash, idx !== undefined ? [idx] : []);
  }

  const tasks = new Listr(
    [...hashesToProcess.entries()].map(([hash, desiredFileIdxs]) => ({
      title: `Adding torrent ${hash.substring(0, 12)}...`,
      task: async (_ctx: unknown, task: { title: string; output: string }) => {
        await qb.addMagnet(hash, outputDir, true);

        task.output = "Waiting for metadata...";
        const files = await qb.waitForMetadata(hash);

        if (desiredFileIdxs.length > 0) {
          const allIdxs = files.map((f) => f.index);
          const unwantedIdxs = allIdxs.filter((i) => !desiredFileIdxs.includes(i));
          if (unwantedIdxs.length > 0) {
            await qb.setFilePriority(hash, unwantedIdxs, 0);
          }
        }

        await qb.resumeTorrent(hash);

        await qb.waitForCompletion(hash, (progress, dlSpeed) => {
          const speedMB = (dlSpeed / 1_048_576).toFixed(1);
          task.output = `${progress.toFixed(1)}% @ ${speedMB} MB/s`;
        });

        task.title = `${hash.substring(0, 12)}... ✓`;
      },
    })),
    {
      concurrent: false,
      rendererOptions: { collapseSubtasks: false },
    },
  );

  await tasks.run();
}

// ── Public API ─────────────────────────────────────────────────────────────

export type DownloadBackend = "direct" | "debrid" | "qbittorrent";

export async function executeDownload(
  plan: DownloadPlan,
  backend: DownloadBackend,
): Promise<string> {
  const outputDir = buildOutputDir(plan);

  switch (backend) {
    case "direct":
      await downloadDirect(plan);
      break;
    case "debrid":
      await downloadViaDebrid(plan);
      break;
    case "qbittorrent":
      await downloadViaQBittorrent(plan);
      break;
  }

  return outputDir;
}
