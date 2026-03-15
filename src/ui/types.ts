export type Tab = "home" | "library" | "settings";

export interface LibraryShow {
  name: string;
  path: string;
  seasons: Array<{
    number: number;
    episodes: Array<{ filename: string; filePath: string; sizeMB: number }>;
  }>;
  totalFiles: number;
  totalSizeMB: number;
}

export interface EpisodeProgress {
  episode: number;
  filename: string;
  status: "pending" | "downloading" | "completed" | "failed";
  percent: number;
  downloadedMB: number;
  totalMB: number;
  speedMBps: number;
}

export interface Job {
  id: string;
  imdbId: string;
  seriesName: string;
  season: number;
  quality: string;
  backend: string;
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

export interface SearchResult {
  id: string;
  name: string;
  poster?: string;
  releaseInfo?: string;
  imdbRating?: string;
  type?: string;
}

export interface SeasonInfo {
  number: number;
  episodes: Array<{
    id: string;
    episode: number;
    name: string;
    released?: string;
  }>;
}

export interface SeriesMeta {
  id: string;
  type?: "movie" | "series";
  name: string;
  year?: string;
  poster?: string;
  description?: string;
  imdbRating?: string;
  seasons: SeasonInfo[];
}

export interface EstimateBreakdown {
  episode: number;
  name: string;
  filename: string;
  bytes: number;
  size: string;
}

export interface Estimate {
  episodes: number;
  totalEpisodes: number;
  resolved: number;
  totalBytes: number;
  totalFormatted: string;
  quality: string;
  breakdown: EstimateBreakdown[];
}

export interface Config {
  addonUrl: string;
  quality: string;
  outputDir: string;
  maxConcurrent: number;
}
