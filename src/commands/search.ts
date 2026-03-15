import { Command } from "commander";
import pc from "picocolors";
import { searchSeries, searchMovies } from "../api/cinemeta.js";
import type { CatalogMeta } from "../types.js";

function formatResult(meta: CatalogMeta, index: number): string {
  const rating = meta.imdbRating ? pc.yellow(`★ ${meta.imdbRating}`) : "";
  const year = meta.releaseInfo ?? meta.year ?? "";
  const type = meta.type === "series" ? pc.blue("[Series]") : pc.green("[Movie]");
  return `  ${pc.dim(`${index + 1}.`)} ${pc.bold(meta.name)} ${type} ${pc.dim(year)} ${rating} ${pc.dim(meta.id)}`;
}

export const searchCommand = new Command("search")
  .description("Search for series or movies")
  .argument("<query>", "Search query")
  .option("-t, --type <type>", "Content type: series, movie, all", "all")
  .action(async (query: string, opts: { type: string }) => {
    const results: CatalogMeta[] = [];

    if (opts.type === "all" || opts.type === "series") {
      const seriesResults = await searchSeries(query);
      results.push(...seriesResults.metas);
    }

    if (opts.type === "all" || opts.type === "movie") {
      const movieResults = await searchMovies(query);
      results.push(...movieResults.metas);
    }

    if (results.length === 0) {
      console.log(pc.red("No results found."));
      return;
    }

    console.log(pc.bold(`\nResults for "${query}":\n`));
    for (let i = 0; i < results.length; i++) {
      console.log(formatResult(results[i]!, i));
    }
    console.log(pc.dim(`\nUse: stremio-dl download <imdb_id> --season <n> to download a season`));
  });
