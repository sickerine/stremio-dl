import type { StreamResponse, Stream, Video } from "../types.js";
import { config } from "../config.js";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Addon request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * Parses a Stremio addon share URL or manifest URL into a base URL for API queries.
 * Handles formats like:
 *   - stremio://host/stremio/wrap/{config}/manifest.json
 *   - https://host/stremio/wrap/{config}/manifest.json
 *   - https://host/stremio/wrap/{config}
 *   - https://torrentio.strem.fun
 *   - https://torrentio.strem.fun/sort=qualitysize/manifest.json
 */
export function parseAddonUrl(input: string): string {
  let url = input.trim();

  // Strip shell escape backslashes (zsh escapes = as \=)
  url = url.replace(/\\(.)/g, "$1");

  // Convert stremio:// protocol to https://
  if (url.startsWith("stremio://")) {
    url = url.replace("stremio://", "https://");
  }

  // Strip trailing /manifest.json
  if (url.endsWith("/manifest.json")) {
    url = url.slice(0, -"/manifest.json".length);
  }

  // Strip trailing slash
  return url.replace(/\/+$/, "");
}

function getAddonUrl(): string {
  const baseUrl = config.get("addons.streamUrl") as string;
  const debridProvider = config.get("debrid.provider") as string;
  const apiKey = config.get("debrid.apiKey") as string;

  // If the addon URL already contains config (like StremThru wrap URLs), use it as-is
  if (baseUrl.includes("/stremio/wrap/") || baseUrl.includes("/stremio/store/")) {
    return baseUrl;
  }

  // For raw Torrentio, append debrid config if available
  if (debridProvider !== "none" && apiKey) {
    return `${baseUrl}/${debridProvider}=${apiKey}`;
  }
  return baseUrl;
}

export async function getStreamsForEpisode(
  imdbId: string,
  season: number,
  episode: number,
): Promise<Stream[]> {
  const addonUrl = getAddonUrl();
  const data = await fetchJson<StreamResponse>(
    `${addonUrl}/stream/series/${imdbId}:${season}:${episode}.json`,
  );
  return data.streams ?? [];
}

export async function getStreamsForMovie(imdbId: string): Promise<Stream[]> {
  const addonUrl = getAddonUrl();
  const data = await fetchJson<StreamResponse>(
    `${addonUrl}/stream/movie/${imdbId}.json`,
  );
  return data.streams ?? [];
}

export async function resolveAllEpisodes(
  imdbId: string,
  episodes: Video[],
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Stream[]>> {
  const results = new Map<string, Stream[]>();
  let done = 0;

  // Fetch in batches of 5 to avoid hammering the addon
  const batchSize = 5;
  for (let i = 0; i < episodes.length; i += batchSize) {
    const batch = episodes.slice(i, i + batchSize);
    const promises = batch.map(async (ep) => {
      const streams = await getStreamsForEpisode(imdbId, ep.season, ep.episode);
      results.set(ep.id, streams);
      done++;
      onProgress?.(done, episodes.length);
    });
    await Promise.all(promises);
  }

  return results;
}

/**
 * Checks if the configured addon returns direct URLs (StremThru, debrid-resolved)
 * vs raw infoHash torrents (raw Torrentio).
 */
export function isStremThruAddon(): boolean {
  const url = config.get("addons.streamUrl") as string;
  return url.includes("/stremio/wrap/") || url.includes("/stremio/store/");
}
