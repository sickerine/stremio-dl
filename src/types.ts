// ── Cinemeta Types ──────────────────────────────────────────────────────────

export interface CinemetaResponse {
  meta: SeriesMeta | MovieMeta;
}

export interface CatalogResponse {
  query?: string;
  rank?: number;
  cacheMaxAge?: number;
  metas: CatalogMeta[];
}

export interface CatalogMeta {
  id: string;
  imdb_id: string;
  type: "movie" | "series";
  name: string;
  poster: string;
  background?: string;
  releaseInfo?: string;
  year?: string;
  imdbRating?: string;
  description?: string;
  behaviorHints: {
    defaultVideoId: string | null;
    hasScheduledVideos: boolean;
  };
}

interface BaseMeta {
  id: string;
  imdb_id: string;
  name: string;
  slug: string;
  description: string;
  genre: string[];
  runtime: string;
  country: string;
  year: string;
  releaseInfo: string;
  released: string;
  cast: string[];
  director: string[] | null;
  writer: string[];
  imdbRating: string;
  poster: string;
  background: string;
  logo?: string;
  popularity: number;
  trailers: { source: string; type: string }[];
}

export interface SeriesMeta extends BaseMeta {
  type: "series";
  status: string;
  videos: Video[];
  moviedb_id?: number;
  tvdb_id?: number;
  behaviorHints: {
    defaultVideoId: null;
    hasScheduledVideos: boolean;
  };
}

export interface MovieMeta extends BaseMeta {
  type: "movie";
  videos: [];
  behaviorHints: {
    defaultVideoId: string;
    hasScheduledVideos: false;
  };
}

export interface Video {
  id: string; // format: "tt{imdb_id}:{season}:{episode}"
  name: string;
  season: number;
  episode: number;
  number: number;
  released: string;
  firstAired: string;
  overview: string;
  description?: string;
  tvdb_id?: number;
  rating?: string | number;
  thumbnail?: string;
}

// ── Stremio Addon Stream Types ─────────────────────────────────────────────

export interface StreamResponse {
  streams: Stream[];
}

export interface Stream {
  name?: string;
  title?: string;
  description?: string;
  infoHash?: string;
  url?: string;
  ytId?: string;
  externalUrl?: string;
  fileIdx?: number;
  sources?: string[];
  behaviorHints?: {
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    videoHash?: string;
    notWebReady?: boolean;
  };
}

// ── Resolved Download Types ────────────────────────────────────────────────

export interface ResolvedEpisode {
  video: Video;
  stream: Stream;
  seasonNumber: number;
  episodeNumber: number;
}

export interface SeasonPack {
  infoHash: string;
  episodes: ResolvedEpisode[];
  name?: string;
  title?: string;
}

export interface DownloadPlan {
  meta: SeriesMeta | MovieMeta;
  type: "movie" | "series";
  season: number; // 0 for movies
  quality: string;
  packs: SeasonPack[];
  individual: ResolvedEpisode[];
  totalEpisodes: number;
  hasDirectUrls: boolean;
}

// ── Real-Debrid Types ──────────────────────────────────────────────────────

export interface RDAddMagnetResponse {
  id: string;
  uri: string;
}

export interface RDTorrentInfo {
  id: string;
  filename: string;
  hash: string;
  bytes: number;
  host: string;
  split: number;
  progress: number;
  status: "magnet_error" | "magnet_conversion" | "waiting_files_selection" | "queued" | "downloading" | "downloaded" | "error" | "virus" | "compressing" | "uploading" | "dead";
  added: string;
  files: RDFile[];
  links: string[];
  ended?: string;
  speed?: number;
  seeders?: number;
}

export interface RDFile {
  id: number;
  path: string;
  bytes: number;
  selected: number;
}

export interface RDUnrestrictResponse {
  id: string;
  filename: string;
  mimeType: string;
  filesize: number;
  link: string;
  host: string;
  chunks: number;
  download: string;
  streamable: number;
}

export interface RDInstantAvailability {
  [hash: string]: {
    rd?: Array<Record<string, { filename: string; filesize: number }>>;
  };
}

// ── qBittorrent Types ──────────────────────────────────────────────────────

export interface QBTorrentInfo {
  hash: string;
  name: string;
  progress: number;
  state: string;
  dlspeed: number;
  upspeed: number;
  eta: number;
  size: number;
  total_size: number;
  amount_left: number;
  completed: number;
  save_path: string;
  content_path: string;
  category: string;
  tags: string;
  added_on: number;
  completion_on: number;
  magnet_uri: string;
  ratio: number;
  num_seeds: number;
  num_leechs: number;
  availability: number;
}

export interface QBFileInfo {
  index: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
  is_seed: boolean;
  piece_range: number[];
  availability: number;
}

// AppConfig is defined in config.ts (single source of truth)
