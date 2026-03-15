import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { select, checkbox, confirm } from "@inquirer/prompts";
import { getSeriesMeta, getSeasons, getEpisodesForSeason } from "../api/cinemeta.js";
import { parseAddonUrl } from "../api/addon.js";
import { resolveDownloadPlan, formatPlanSummary } from "../core/resolver.js";
import { executeDownload, type DownloadBackend } from "../core/downloader.js";
import { config } from "../config.js";

export const downloadCommand = new Command("download")
  .description("Download a season or movie")
  .argument("<imdb_id>", "IMDB ID (e.g., tt0903747)")
  .option("-s, --season <number>", "Season number (interactive if omitted)")
  .option("-q, --quality <quality>", "Preferred quality (2160p, 1080p, 720p, 480p)")
  .option("-b, --backend <backend>", "Download backend: direct, debrid, qbittorrent")
  .option("-o, --output <dir>", "Output directory")
  .option("-e, --episodes <episodes>", "Specific episodes (e.g., 1,2,3 or 1-5)")
  .option("-a, --addon <url>", "Stremio addon URL or share link")
  .option("-y, --yes", "Skip confirmation prompts")
  .action(async (imdbId: string, opts: {
    season?: string;
    quality?: string;
    backend?: string;
    output?: string;
    episodes?: string;
    addon?: string;
    yes?: boolean;
  }) => {
    // Set addon URL if provided
    if (opts.addon) {
      const parsed = parseAddonUrl(opts.addon);
      config.set("addons.streamUrl", parsed);
      console.log(pc.dim(`Addon URL: ${parsed}\n`));
    }

    // Fetch series metadata
    const spinner = ora("Fetching series metadata...").start();
    let meta;
    try {
      meta = await getSeriesMeta(imdbId);
      spinner.succeed(`${pc.bold(meta.name)} (${meta.releaseInfo})`);
    } catch (err) {
      spinner.fail("Failed to fetch metadata");
      console.error(pc.red(String(err)));
      process.exit(1);
    }

    // Select season
    const seasons = getSeasons(meta);
    let season: number;

    if (opts.season) {
      season = parseInt(opts.season, 10);
      if (!seasons.includes(season)) {
        console.error(pc.red(`Season ${season} not found. Available: ${seasons.join(", ")}`));
        process.exit(1);
      }
    } else {
      season = await select({
        message: "Select season:",
        choices: seasons.map((s) => ({
          name: `Season ${s} (${getEpisodesForSeason(meta, s).length} episodes)`,
          value: s,
        })),
      });
    }

    // Get episodes
    let episodes = getEpisodesForSeason(meta, season);

    // Filter specific episodes if requested
    if (opts.episodes) {
      const requestedEps = parseEpisodeRange(opts.episodes);
      episodes = episodes.filter((ep) => requestedEps.includes(ep.episode));
      if (episodes.length === 0) {
        console.error(pc.red("No matching episodes found"));
        process.exit(1);
      }
    } else if (!opts.yes) {
      const selectedIds = await checkbox({
        message: `Select episodes (${episodes.length} available):`,
        choices: episodes.map((ep) => ({
          name: `E${String(ep.episode).padStart(2, "0")} — ${ep.name}`,
          value: ep.id,
          checked: true,
        })),
      });

      episodes = episodes.filter((ep) => selectedIds.includes(ep.id));
    }

    console.log(pc.dim(`\nSelected ${episodes.length} episodes from Season ${season}\n`));

    // Select quality
    const quality = opts.quality ?? (config.get("download.preferredQuality") as string);

    // Set output dir if specified
    if (opts.output) {
      config.set("download.outputDir", opts.output);
    }

    // Resolve streams
    const resolveSpinner = ora("Resolving streams from addons...").start();
    let plan;
    try {
      plan = await resolveDownloadPlan(meta, season, episodes, quality, (done, total) => {
        resolveSpinner.text = `Resolving streams... ${done}/${total}`;
      });
      resolveSpinner.succeed("Streams resolved");
    } catch (err) {
      resolveSpinner.fail("Failed to resolve streams");
      console.error(pc.red(String(err)));
      process.exit(1);
    }

    // Show plan
    console.log(`\n${formatPlanSummary(plan)}\n`);

    const resolvedCount = plan.packs.reduce((sum, p) => sum + p.episodes.length, 0) + plan.individual.length;
    if (resolvedCount === 0) {
      console.log(pc.red("No streams found for any episode. Try a different addon or quality."));
      process.exit(1);
    }

    // Select backend — auto-detect based on stream type
    let backend: DownloadBackend;
    if (opts.backend) {
      backend = opts.backend as DownloadBackend;
    } else if (plan.hasDirectUrls) {
      // Streams have direct URLs — download directly
      backend = "direct";
      console.log(pc.dim("Auto-detected direct download URLs\n"));
    } else {
      const debridKey = config.get("debrid.apiKey") as string;
      if (debridKey) {
        backend = "debrid";
      } else {
        backend = await select({
          message: "Select download backend:",
          choices: [
            { name: "Real-Debrid (fast, requires API key)", value: "debrid" as const },
            { name: "qBittorrent (free, requires qBit running)", value: "qbittorrent" as const },
          ],
        });
      }
    }

    // Confirm
    if (!opts.yes) {
      const proceed = await confirm({
        message: `Download ${resolvedCount} episodes via ${backend}?`,
      });
      if (!proceed) {
        console.log(pc.dim("Cancelled."));
        process.exit(0);
      }
    }

    // Execute download
    console.log("");
    try {
      const outputDir = await executeDownload(plan, backend);
      console.log(pc.green(`\nDownload complete! Files saved to: ${outputDir}`));
    } catch (err) {
      console.error(pc.red(`\nDownload failed: ${err}`));
      process.exit(1);
    }
  });

function parseEpisodeRange(input: string): number[] {
  const episodes: number[] = [];
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = parseInt(startStr!, 10);
      const end = parseInt(endStr!, 10);
      for (let i = start; i <= end; i++) {
        episodes.push(i);
      }
    } else {
      episodes.push(parseInt(trimmed, 10));
    }
  }
  return episodes;
}
