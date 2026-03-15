import type {
  RDAddMagnetResponse,
  RDTorrentInfo,
  RDUnrestrictResponse,
} from "../types.js";
import { config } from "../config.js";

const BASE_URL = "https://api.real-debrid.com/rest/1.0";
const MIN_REQUEST_INTERVAL = 250; // 250ms = ~240 req/min (limit is 250/min)
let lastRequestTime = 0;

function getHeaders(): Record<string, string> {
  const apiKey = config.get("debrid.apiKey") as string;
  if (!apiKey) throw new Error("Real-Debrid API key not configured. Run: stremio-dl config set debrid.apiKey <your-key>");
  return { Authorization: `Bearer ${apiKey}` };
}

async function rdFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  // Rate limiting
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL) {
    await new Promise((r) => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
  }
  lastRequestTime = Date.now();

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...getHeaders(), ...options.headers },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Real-Debrid API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function addMagnet(magnetOrHash: string): Promise<RDAddMagnetResponse> {
  const magnet = magnetOrHash.startsWith("magnet:")
    ? magnetOrHash
    : `magnet:?xt=urn:btih:${magnetOrHash}`;

  const body = new URLSearchParams({ magnet });
  return rdFetch<RDAddMagnetResponse>("/torrents/addMagnet", {
    method: "POST",
    body,
  });
}

export async function getTorrentInfo(id: string): Promise<RDTorrentInfo> {
  return rdFetch<RDTorrentInfo>(`/torrents/info/${id}`);
}

export async function selectFiles(id: string, fileIds: string = "all"): Promise<void> {
  const body = new URLSearchParams({ files: fileIds });
  await fetch(`${BASE_URL}/torrents/selectFiles/${id}`, {
    method: "POST",
    headers: getHeaders(),
    body,
  });
}

export async function unrestrictLink(link: string): Promise<RDUnrestrictResponse> {
  const body = new URLSearchParams({ link });
  return rdFetch<RDUnrestrictResponse>("/unrestrict/link", {
    method: "POST",
    body,
  });
}

export async function deleteTorrent(id: string): Promise<void> {
  await fetch(`${BASE_URL}/torrents/delete/${id}`, {
    method: "DELETE",
    headers: getHeaders(),
  });
}

export async function waitForDownload(
  id: string,
  onProgress?: (progress: number, status: string) => void,
  timeoutMs: number = 600_000,
): Promise<RDTorrentInfo> {
  const start = Date.now();
  const pollInterval = 2000;

  while (Date.now() - start < timeoutMs) {
    const info = await getTorrentInfo(id);
    onProgress?.(info.progress, info.status);

    if (info.status === "downloaded") return info;
    if (info.status === "error" || info.status === "magnet_error" || info.status === "dead") {
      throw new Error(`Real-Debrid torrent failed with status: ${info.status}`);
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new Error("Real-Debrid download timed out");
}

/**
 * Resolves download links for a torrent.
 *
 * IMPORTANT: The addon's `fileIdx` (0-based position in torrent) is NOT the same
 * as Real-Debrid's file IDs. RD assigns its own IDs in the torrent info response.
 * We match by positional index: RD files are sorted by path, and fileIdx corresponds
 * to the position within the torrent's file list.
 */
export async function getDownloadLinks(
  infoHash: string,
  addonFileIdxs?: number[],
): Promise<{ url: string; filename: string }[]> {
  const { id } = await addMagnet(infoHash);

  // Wait for file list to be available
  let info = await getTorrentInfo(id);
  while (info.status === "magnet_conversion") {
    await new Promise((r) => setTimeout(r, 1000));
    info = await getTorrentInfo(id);
  }

  // Map addon fileIdx to Real-Debrid file IDs
  // RD files have their own `id` field. We need to select by RD's IDs.
  if (addonFileIdxs && addonFileIdxs.length > 0 && info.files.length > 0) {
    // RD file IDs are 1-based and correspond to position in the torrent
    // Addon fileIdx is 0-based. RD file at position N has id = N+1 (typically).
    // But safer: match by index position since RD lists files in torrent order.
    const rdFileIds = addonFileIdxs
      .map((idx) => {
        // Find the RD file that corresponds to this torrent file index
        // RD files are listed in order, so file at torrent index `idx` has RD id = idx + 1
        const rdFile = info.files[idx];
        return rdFile?.id;
      })
      .filter((id): id is number => id !== undefined);

    if (rdFileIds.length > 0) {
      await selectFiles(id, rdFileIds.join(","));
    } else {
      await selectFiles(id, "all");
    }
  } else {
    await selectFiles(id, "all");
  }

  // Wait for download to complete
  info = await waitForDownload(id);

  // Unrestrict each link to get direct download URLs
  const results: { url: string; filename: string }[] = [];
  for (const link of info.links) {
    const unrestricted = await unrestrictLink(link);
    results.push({
      url: unrestricted.download,
      filename: unrestricted.filename,
    });
  }

  return results;
}
