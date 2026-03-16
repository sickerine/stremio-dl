import { createWriteStream, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { Listr } from "listr2";
import type { DownloadPlan, ResolvedEpisode, Stream } from "../types.js";
import * as rd from "../api/real-debrid.js";
import * as qb from "../api/qbittorrent.js";
import { config } from "../config.js";

/** Parse expected file size from stream metadata. Checks behaviorHints, then parses size from text fields. */
export function getExpectedBytes(stream: Stream): number {
  if (stream.behaviorHints?.videoSize) return stream.behaviorHints.videoSize;
  // Search all text fields for size patterns: 💾 2.88 GB or 📦 6.27 GB
  const text = `${stream.title ?? ""} ${stream.description ?? ""}`;
  const m = text.match(/[💾📦]\s*([\d.]+)\s*(GB|MB|TB)/i);
  if (!m) return 0;
  const val = parseFloat(m[1]!);
  const unit = m[2]!.toUpperCase();
  return Math.round(unit === "TB" ? val * 1_099_511_627_776 : unit === "GB" ? val * 1_073_741_824 : val * 1_048_576);
}

const PLACEHOLDER_THRESHOLD = 10_000_000;

export async function resolveFileSize(stream: Stream): Promise<number> {
  const fromMeta = getExpectedBytes(stream);
  if (fromMeta > 0) return fromMeta;
  if (!stream.url) return 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(stream.url, { method: "HEAD", redirect: "follow" });
      const cl = r.headers.get("content-length");
      const bytes = cl ? parseInt(cl, 10) : 0;
      if (bytes > PLACEHOLDER_THRESHOLD) return bytes;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 5000));
    } catch { /* retry */ }
  }
  return 0;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

async function downloadFile(
  url: string,
  outputPath: string,
  onProgress?: (percent: number, downloadedMB: number, totalMB: number, speedMBps: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response | null = null;
  const maxWait = 5 * 60_000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    signal?.throwIfAborted();
    res = await fetch(url, { redirect: "follow", signal });
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    if (!res.body) throw new Error("No response body");

    const cl = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (cl === 0 || cl > PLACEHOLDER_THRESHOLD) break;

    await res.body.cancel();
    res = null;
    // Signal-aware sleep
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, 10_000);
      const onAbort = () => { clearTimeout(timer); reject(signal!.reason); };
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  if (!res || !res.body) throw new Error("Timed out waiting for debrid to cache this file");

  const totalBytes = parseInt(res.headers.get("content-length") ?? "0", 10);
  let downloadedBytes = 0;
  let lastTime = Date.now();
  let lastBytes = 0;
  let speedMBps = 0;

  const nodeStream = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);

  nodeStream.on("data", (chunk: Buffer) => {
    downloadedBytes += chunk.length;
    const now = Date.now();
    const elapsed = (now - lastTime) / 1000;
    if (elapsed >= 0.5) {
      speedMBps = (downloadedBytes - lastBytes) / 1_048_576 / elapsed;
      lastTime = now;
      lastBytes = downloadedBytes;
    }
    if (totalBytes > 0) {
      onProgress?.((downloadedBytes / totalBytes) * 100, downloadedBytes / 1_048_576, totalBytes / 1_048_576, speedMBps);
    }
  });

  try {
    await pipeline(nodeStream, createWriteStream(outputPath), { signal } as any);
  } catch (err) {
    try { unlinkSync(outputPath); } catch { /* already gone */ }
    throw err;
  }

  if (totalBytes > 0 && downloadedBytes < totalBytes * 0.99) {
    throw new Error(`Truncated download: got ${downloadedBytes} of ${totalBytes} bytes`);
  }
}

function buildOutputDir(plan: DownloadPlan): string {
  const base = config.get("download.outputDir") as string;
  const name = sanitizeFilename(plan.meta.name);
  if (plan.type === "movie") {
    return join(base, name);
  }
  const seasonDir = `Season ${String(plan.season).padStart(2, "0")}`;
  return join(base, name, seasonDir);
}

function buildEpisodeFilename(ep: ResolvedEpisode): string {
  const hint = ep.stream.behaviorHints?.filename;
  if (hint) return sanitizeFilename(hint);
  const name = ep.video.name;
  const sNum = String(ep.seasonNumber).padStart(2, "0");
  const eNum = String(ep.episodeNumber).padStart(2, "0");
  return sanitizeFilename(`S${sNum}E${eNum} - ${name}.mkv`);
}

// ── Real-Debrid Backend ────────────────────────────────────────────────────

async function downloadViaDebrid(plan: DownloadPlan): Promise<void> {
  const outputDir = buildOutputDir(plan);
  ensureDir(outputDir);
  const maxConcurrent = config.get("download.maxConcurrent") as number;

  interface DownloadItem { url: string; filename: string; }
  const items: DownloadItem[] = [];

  for (const pack of plan.packs) {
    const fileIdxs = pack.episodes.map((ep) => ep.stream.fileIdx).filter((idx): idx is number => idx !== undefined);
    const results = await rd.getDownloadLinks(pack.infoHash, fileIdxs.length > 0 ? fileIdxs : undefined);
    for (const result of results) {
      const matchingEp = pack.episodes.find((ep) => {
        const hint = ep.stream.behaviorHints?.filename;
        return hint && result.filename.includes(hint.replace(/\.[^.]+$/, ""));
      });
      items.push({ url: result.url, filename: matchingEp ? buildEpisodeFilename(matchingEp) : sanitizeFilename(result.filename) });
    }
  }

  for (const ep of plan.individual) {
    const fileIdxs = ep.stream.fileIdx !== undefined ? [ep.stream.fileIdx] : undefined;
    const results = await rd.getDownloadLinks(ep.stream.infoHash!, fileIdxs);
    if (results[0]) items.push({ url: results[0].url, filename: buildEpisodeFilename(ep) });
  }

  if (items.length === 0) throw new Error("No download links could be resolved");

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
    { concurrent: maxConcurrent, rendererOptions: { collapseSubtasks: false } },
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
    const fileIdxs = pack.episodes.map((ep) => ep.stream.fileIdx).filter((idx): idx is number => idx !== undefined);
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
          if (unwantedIdxs.length > 0) await qb.setFilePriority(hash, unwantedIdxs, 0);
        }
        await qb.resumeTorrent(hash);
        await qb.waitForCompletion(hash, (progress, dlSpeed) => {
          task.output = `${progress.toFixed(1)}% @ ${(dlSpeed / 1_048_576).toFixed(1)} MB/s`;
        });
        task.title = `${hash.substring(0, 12)}... ✓`;
      },
    })),
    { concurrent: false, rendererOptions: { collapseSubtasks: false } },
  );
  await tasks.run();
}

// ── Public API ─────────────────────────────────────────────────────────────

export type DownloadBackend = "direct" | "debrid" | "qbittorrent";

export interface FileProgress {
  index: number;
  filename: string;
  status: "pending" | "downloading" | "completed" | "failed";
  percent: number;
  downloadedMB: number;
  totalMB: number;
  speedMBps: number;
}

export type ProgressCallback = (files: FileProgress[]) => void;

// ── Global download semaphore (abort-aware) ───────────────────────────────

class Semaphore {
  private queue: Array<{ resolve: () => void; reject: (err: unknown) => void }> = [];
  private active = 0;
  constructor(private max: number) {}

  async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const entry = {
        resolve: () => { this.active++; resolve(); },
        reject,
      };
      this.queue.push(entry);
      signal?.addEventListener("abort", () => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) {
          this.queue.splice(idx, 1);
          reject(signal.reason);
        }
      }, { once: true });
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next.resolve();
  }
}

let globalSemaphore: Semaphore | null = null;

function getSemaphore(): Semaphore {
  if (!globalSemaphore) {
    const max = config.get("download.maxConcurrent") as number;
    globalSemaphore = new Semaphore(max);
  }
  return globalSemaphore;
}

// ── Direct with progress tracking ─────────────────────────────────────────

async function downloadDirectWithProgress(plan: DownloadPlan, onProgress?: ProgressCallback, signal?: AbortSignal): Promise<void> {
  const outputDir = buildOutputDir(plan);
  ensureDir(outputDir);
  const sem = getSemaphore();
  const episodes = plan.individual;
  if (episodes.length === 0) throw new Error("No episodes with direct URLs to download");

  const fileStates: FileProgress[] = episodes.map((ep, i) => ({
    index: i,
    filename: buildEpisodeFilename(ep),
    status: "pending" as const,
    percent: 0, downloadedMB: 0, totalMB: 0, speedMBps: 0,
  }));

  const report = (): void => onProgress?.(fileStates);

  await Promise.all(episodes.map(async (ep, i) => {
    const bytes = await resolveFileSize(ep.stream);
    if (bytes > 0) fileStates[i]!.totalMB = bytes / 1_048_576;
  }));
  report();

  const downloads = episodes.map(async (ep, i) => {
    const state = fileStates[i]!;
    const outputPath = join(outputDir, state.filename);

    try {
      await sem.acquire(signal);
    } catch {
      state.status = "failed";
      report();
      return;
    }

    state.status = "downloading";
    report();

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        signal?.throwIfAborted();
        if (attempt > 0) {
          state.percent = 0; state.downloadedMB = 0; state.speedMBps = 0;
          report();
          await new Promise((r) => setTimeout(r, 3000 * attempt));
        }
        try {
          await downloadFile(ep.stream.url!, outputPath, (percent, dlMB, totalMB, speed) => {
            state.percent = percent; state.downloadedMB = dlMB; state.totalMB = totalMB; state.speedMBps = speed;
            report();
          }, signal);
          state.status = "completed"; state.percent = 100; state.speedMBps = 0;
          report();
          return;
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          state.percent = 0; state.downloadedMB = 0; state.speedMBps = 0;
        }
      }
      state.status = "failed";
      report();
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        state.status = "failed";
        try { unlinkSync(outputPath); } catch { /* ok */ }
      } else {
        state.status = "failed";
      }
      report();
    } finally {
      sem.release();
    }
  });

  await Promise.allSettled(downloads);
}

export async function executeDownload(
  plan: DownloadPlan,
  backend: DownloadBackend,
  onProgress?: ProgressCallback,
  signal?: AbortSignal,
): Promise<string> {
  const outputDir = buildOutputDir(plan);
  switch (backend) {
    case "direct":
      await downloadDirectWithProgress(plan, onProgress, signal);
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
