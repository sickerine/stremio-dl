import type {
  CatalogResponse,
  CinemetaResponse,
  SeriesMeta,
  MovieMeta,
  Video,
} from "../types.js";

const BASE_URL = "https://v3-cinemeta.strem.io";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`Cinemeta request failed: ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function searchSeries(query: string): Promise<CatalogResponse> {
  const encoded = encodeURIComponent(query);
  return fetchJson(`${BASE_URL}/catalog/series/top/search=${encoded}.json`);
}

export async function searchMovies(query: string): Promise<CatalogResponse> {
  const encoded = encodeURIComponent(query);
  return fetchJson(`${BASE_URL}/catalog/movie/top/search=${encoded}.json`);
}

export async function getSeriesMeta(imdbId: string): Promise<SeriesMeta> {
  const data = await fetchJson<CinemetaResponse>(`${BASE_URL}/meta/series/${imdbId}.json`);
  return data.meta as SeriesMeta;
}

export async function getMovieMeta(imdbId: string): Promise<MovieMeta> {
  const data = await fetchJson<CinemetaResponse>(`${BASE_URL}/meta/movie/${imdbId}.json`);
  return data.meta as MovieMeta;
}

/**
 * Auto-detect type and fetch metadata. Tries series first, falls back to movie.
 */
export async function getMeta(imdbId: string): Promise<SeriesMeta | MovieMeta> {
  try {
    const data = await fetchJson<CinemetaResponse>(`${BASE_URL}/meta/series/${imdbId}.json`);
    if (data.meta && (data.meta as SeriesMeta).videos?.length > 0) {
      return data.meta as SeriesMeta;
    }
  } catch { /* not a series */ }

  const data = await fetchJson<CinemetaResponse>(`${BASE_URL}/meta/movie/${imdbId}.json`);
  if (!data.meta) throw new Error(`No metadata found for ${imdbId}`);
  return data.meta as MovieMeta;
}

function isReleased(v: Video): boolean {
  if (!v.released) return false;
  return new Date(v.released).getTime() <= Date.now();
}

export function getSeasons(meta: SeriesMeta): number[] {
  const released = meta.videos.filter(isReleased);
  const seasons = new Set(released.map((v) => v.season));
  return [...seasons].filter((s) => s > 0).sort((a, b) => a - b);
}

export function getEpisodesForSeason(meta: SeriesMeta, season: number): Video[] {
  return meta.videos
    .filter((v) => v.season === season && isReleased(v))
    .sort((a, b) => a.episode - b.episode);
}
