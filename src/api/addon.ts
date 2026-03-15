import type { StreamResponse, Stream, Video } from "../types.js";
import { config } from "../config.js";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Addon request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/**
 * Parses a Stremio addon share URL or manifest URL into a base URL for API queries.
 */
export function parseAddonUrl(input: string): string {
  let url = input.trim();
  url = url.replace(/\\(.)/g, "$1");
  if (url.startsWith("stremio://")) {
    url = url.replace("stremio://", "https://");
  }
  if (url.endsWith("/manifest.json")) {
    url = url.slice(0, -"/manifest.json".length);
  }
  return url.replace(/\/+$/, "");
}

function getAddonUrl(): string {
  const baseUrl = config.get("addons.streamUrl") as string;
  if (!baseUrl) throw new Error("No addon URL configured. Set one in Config.");
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
