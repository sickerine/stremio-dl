import type {
  Stream,
  Video,
  ResolvedEpisode,
  SeasonPack,
  DownloadPlan,
  SeriesMeta,
  MovieMeta,
} from "../types.js";
import { resolveAllEpisodes, getStreamsForMovie, isStremThruAddon } from "../api/addon.js";

const QUALITY_PATTERNS: Record<string, RegExp> = {
  "2160p": /2160p|4k|uhd/i,
  "1080p": /1080p/i,
  "720p": /720p/i,
  "480p": /480p/i,
};

const QUALITY_RANK: Record<string, number> = {
  "2160p": 4,
  "1080p": 3,
  "720p": 2,
  "480p": 1,
};

function getStreamQuality(stream: Stream): string {
  const text = `${stream.name ?? ""} ${stream.title ?? ""}`;
  for (const [quality, pattern] of Object.entries(QUALITY_PATTERNS)) {
    if (pattern.test(text)) return quality;
  }
  return "unknown";
}

function parseSeederCount(stream: Stream): number {
  const match = stream.title?.match(/👤\s*(\d+)/);
  return match ? parseInt(match[1]!, 10) : 0;
}

const EXCLUDE_PATTERNS: Record<string, RegExp> = {
  "60fps": /60\s*fps|60p/i,
  "cam": /\bcam\b|camrip|hdcam/i,
  "screener": /\bscr\b|screener/i,
};

const REQUIRE_PATTERNS: Record<string, RegExp> = {
  "webdl": /web[\s._-]?dl|webrip|web[\s._-]?rip|amzn|nf|dsnp|hulu|atvp|pcok|hmax/i,
};

function matchesExclude(stream: Stream, excludes: string[]): boolean {
  if (excludes.length === 0) return false;
  const text = `${stream.name ?? ""} ${stream.title ?? ""} ${stream.behaviorHints?.filename ?? ""}`;
  return excludes.some((key) => {
    const pattern = EXCLUDE_PATTERNS[key];
    return pattern ? pattern.test(text) : text.toLowerCase().includes(key.toLowerCase());
  });
}

function matchesRequire(stream: Stream, requires: string[]): boolean {
  if (requires.length === 0) return true;
  const text = `${stream.name ?? ""} ${stream.title ?? ""} ${stream.behaviorHints?.filename ?? ""}`;
  return requires.every((key) => {
    const pattern = REQUIRE_PATTERNS[key];
    return pattern ? pattern.test(text) : text.toLowerCase().includes(key.toLowerCase());
  });
}

function scoreStream(stream: Stream, preferredQuality: string): number {
  const quality = getStreamQuality(stream);
  const qualityRank = QUALITY_RANK[quality] ?? 0;
  const preferredRank = QUALITY_RANK[preferredQuality] ?? 3;

  const qualityScore = qualityRank === preferredRank ? 100 : 100 - Math.abs(qualityRank - preferredRank) * 25;
  const seederScore = Math.min(parseSeederCount(stream), 50);

  return qualityScore + seederScore;
}

function isDownloadableStream(stream: Stream): boolean {
  return !!(stream.infoHash || stream.url);
}

export function pickBestStream(streams: Stream[], preferredQuality: string, excludes: string[] = [], requires: string[] = []): Stream | undefined {
  let downloadable = streams.filter(isDownloadableStream);
  if (excludes.length > 0) {
    downloadable = downloadable.filter((s) => !matchesExclude(s, excludes));
  }
  if (requires.length > 0) {
    const filtered = downloadable.filter((s) => matchesRequire(s, requires));
    if (filtered.length > 0) downloadable = filtered;
  }
  if (downloadable.length === 0) return undefined;

  return downloadable.sort((a, b) => scoreStream(b, preferredQuality) - scoreStream(a, preferredQuality))[0];
}

// ── Movie download plan ──────────────────────────────────────────────────────

export async function resolveMovieDownloadPlan(
  meta: MovieMeta,
  preferredQuality: string,
  excludes: string[] = [],
  requires: string[] = [],
): Promise<DownloadPlan> {
  const streams = await getStreamsForMovie(meta.imdb_id);
  const best = pickBestStream(streams, preferredQuality, excludes, requires);

  if (!best) {
    return {
      meta,
      type: "movie",
      season: 0,
      quality: preferredQuality,
      packs: [],
      individual: [],
      totalEpisodes: 1,
      hasDirectUrls: false,
    };
  }

  const video: Video = {
    id: meta.imdb_id,
    name: meta.name,
    season: 0,
    episode: 1,
    number: 1,
    released: meta.released,
    firstAired: meta.released,
    overview: meta.description,
  };

  const resolved: ResolvedEpisode = {
    video,
    stream: best,
    seasonNumber: 0,
    episodeNumber: 1,
  };

  return {
    meta,
    type: "movie",
    season: 0,
    quality: preferredQuality,
    packs: [],
    individual: [resolved],
    totalEpisodes: 1,
    hasDirectUrls: !!best.url,
  };
}

// ── Series download plan ─────────────────────────────────────────────────────

export async function resolveDownloadPlan(
  meta: SeriesMeta,
  season: number,
  episodes: Video[],
  preferredQuality: string,
  onProgress?: (done: number, total: number) => void,
  excludes: string[] = [],
  requires: string[] = [],
): Promise<DownloadPlan> {
  const allStreams = await resolveAllEpisodes(meta.imdb_id, episodes, onProgress);
  const stremthru = isStremThruAddon();

  const resolved: ResolvedEpisode[] = [];
  for (const ep of episodes) {
    const streams = allStreams.get(ep.id) ?? [];
    const best = pickBestStream(streams, preferredQuality, excludes, requires);
    if (best) {
      resolved.push({
        video: ep,
        stream: best,
        seasonNumber: ep.season,
        episodeNumber: ep.episode,
      });
    }
  }

  const hasDirectUrls = resolved.every((ep) => !!ep.stream.url);

  if (hasDirectUrls || stremthru) {
    return {
      meta,
      type: "series",
      season,
      quality: preferredQuality,
      packs: [],
      individual: resolved.sort((a, b) => a.episodeNumber - b.episodeNumber),
      totalEpisodes: episodes.length,
      hasDirectUrls: true,
    };
  }

  const hashGroups = new Map<string, ResolvedEpisode[]>();
  for (const ep of resolved) {
    const hash = ep.stream.infoHash!;
    const group = hashGroups.get(hash) ?? [];
    group.push(ep);
    hashGroups.set(hash, group);
  }

  const packs: SeasonPack[] = [];
  const individual: ResolvedEpisode[] = [];

  for (const [infoHash, group] of hashGroups) {
    if (group.length > 1) {
      packs.push({
        infoHash,
        episodes: group.sort((a, b) => a.episodeNumber - b.episodeNumber),
        name: group[0]?.stream.name,
        title: group[0]?.stream.title,
      });
    } else if (group[0]) {
      individual.push(group[0]);
    }
  }

  return {
    meta,
    type: "series",
    season,
    quality: preferredQuality,
    packs: packs.sort((a, b) => b.episodes.length - a.episodes.length),
    individual: individual.sort((a, b) => a.episodeNumber - b.episodeNumber),
    totalEpisodes: episodes.length,
    hasDirectUrls: false,
  };
}

export function formatPlanSummary(plan: DownloadPlan): string {
  const lines: string[] = [];

  if (plan.type === "movie") {
    lines.push(`${plan.meta.name} (Movie)`);
  } else {
    lines.push(`${plan.meta.name} — Season ${plan.season}`);
  }

  lines.push(`Quality: ${plan.quality}`);
  lines.push(`Total: ${plan.totalEpisodes}`);

  const resolvedCount = plan.packs.reduce((sum, p) => sum + p.episodes.length, 0) + plan.individual.length;
  lines.push(`Resolved: ${resolvedCount}/${plan.totalEpisodes}`);

  if (plan.hasDirectUrls) {
    lines.push("");
    lines.push("Mode: Direct download (StremThru / debrid-resolved)");
    for (const ep of plan.individual) {
      const hint = ep.stream.behaviorHints?.filename ?? ep.video.name;
      if (plan.type === "movie") {
        lines.push(`  ${hint}`);
      } else {
        lines.push(`  E${String(ep.episodeNumber).padStart(2, "0")} — ${hint}`);
      }
    }
  } else {
    if (plan.packs.length > 0) {
      lines.push("");
      lines.push("Season packs detected:");
      for (const pack of plan.packs) {
        const epNums = pack.episodes.map((e) => `E${String(e.episodeNumber).padStart(2, "0")}`).join(", ");
        lines.push(`  ${pack.infoHash.substring(0, 8)}... -> ${pack.episodes.length} episodes (${epNums})`);
      }
    }

    if (plan.individual.length > 0) {
      lines.push("");
      lines.push("Individual:");
      for (const ep of plan.individual) {
        lines.push(`  ${ep.stream.infoHash?.substring(0, 8)}...`);
      }
    }
  }

  return lines.join("\n");
}
