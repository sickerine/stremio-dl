import type { QBTorrentInfo, QBFileInfo } from "../types.js";
import { config } from "../config.js";

let sessionCookie = "";

function getBaseUrl(): string {
  return config.get("qbittorrent.url");
}

async function qbFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${getBaseUrl()}/api/v2${path}`, {
    ...options,
    headers: {
      Cookie: sessionCookie,
      Referer: getBaseUrl(),
      ...options.headers,
    },
  });
  return res;
}

export async function login(): Promise<void> {
  const username = config.get("qbittorrent.username") as string;
  const password = config.get("qbittorrent.password") as string;

  const body = new URLSearchParams({ username, password });
  const res = await fetch(`${getBaseUrl()}/api/v2/auth/login`, {
    method: "POST",
    body,
    headers: {
      Referer: getBaseUrl(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!res.ok) throw new Error(`qBittorrent login failed: ${res.status}`);

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    const match = setCookie.match(/SID=([^;]+)/);
    if (match?.[1]) sessionCookie = `SID=${match[1]}`;
  }

  const text = await res.text();
  if (text !== "Ok.") throw new Error(`qBittorrent login failed: ${text}`);
}

export async function addMagnet(
  magnetOrHash: string,
  savePath?: string,
  paused = false,
): Promise<void> {
  const magnet = magnetOrHash.startsWith("magnet:")
    ? magnetOrHash
    : `magnet:?xt=urn:btih:${magnetOrHash}`;

  const formData = new FormData();
  formData.set("urls", magnet);
  if (savePath) formData.set("savepath", savePath);
  if (paused) formData.set("paused", "true");

  const res = await qbFetch("/torrents/add", {
    method: "POST",
    body: formData,
  });

  if (!res.ok) throw new Error(`qBittorrent add torrent failed: ${res.status}`);
}

export async function getTorrentInfo(hash: string): Promise<QBTorrentInfo | undefined> {
  const res = await qbFetch(`/torrents/info?hashes=${hash.toLowerCase()}`);
  if (!res.ok) throw new Error(`qBittorrent info failed: ${res.status}`);
  const torrents = (await res.json()) as QBTorrentInfo[];
  return torrents[0];
}

export async function getFiles(hash: string): Promise<QBFileInfo[]> {
  const res = await qbFetch(`/torrents/files?hash=${hash.toLowerCase()}`);
  if (!res.ok) throw new Error(`qBittorrent files failed: ${res.status}`);
  return res.json() as Promise<QBFileInfo[]>;
}

export async function setFilePriority(
  hash: string,
  fileIds: number[],
  priority: 0 | 1 | 6 | 7,
): Promise<void> {
  const body = new URLSearchParams({
    hash: hash.toLowerCase(),
    id: fileIds.join("|"),
    priority: String(priority),
  });

  const res = await qbFetch("/torrents/filePrio", {
    method: "POST",
    body,
  });

  if (res.status === 409) {
    throw new Error("qBittorrent: torrent metadata not yet available, try again");
  }
  if (!res.ok) throw new Error(`qBittorrent setFilePriority failed: ${res.status}`);
}

export async function resumeTorrent(hash: string): Promise<void> {
  const body = new URLSearchParams({ hashes: hash.toLowerCase() });
  await qbFetch("/torrents/resume", { method: "POST", body });
}

export async function waitForMetadata(hash: string, timeoutMs = 60_000): Promise<QBFileInfo[]> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getTorrentInfo(hash);
    if (info && info.state !== "metaDL") {
      const files = await getFiles(hash);
      if (files.length > 0) return files;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Timed out waiting for torrent metadata");
}

export async function waitForCompletion(
  hash: string,
  onProgress?: (progress: number, dlSpeed: number) => void,
  timeoutMs = 3_600_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await getTorrentInfo(hash);
    if (!info) throw new Error("Torrent not found");

    onProgress?.(info.progress * 100, info.dlspeed);

    if (info.progress >= 1) return;
    if (info.state === "error" || info.state === "missingFiles") {
      throw new Error(`qBittorrent torrent error: ${info.state}`);
    }

    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("qBittorrent download timed out");
}
