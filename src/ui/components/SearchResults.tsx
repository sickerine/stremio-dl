import { h } from "preact";
import { memo } from "preact/compat";
import type { SearchResult } from "../types";
import { ChevronIcon } from "./Icons";

interface SearchResultsProps {
  results: SearchResult[];
  onSelect: (id: string) => void;
}

export const SearchResults = memo(function SearchResults({ results, onSelect }: SearchResultsProps) {
  if (!results.length) return null;

  return (
    <div>
      <div class="panel-label" style="margin-top:8px">Results</div>
      {results.map((r) => (
        <div key={r.id} class="result" onClick={() => onSelect(r.id)}>
          {r.poster ? (
            <img class="result-poster" src={r.poster} alt="" loading="lazy" />
          ) : (
            <div class="result-poster" />
          )}
          <div class="result-body">
            <div class="result-title">{r.name}</div>
            <div class="result-meta">
              {r.releaseInfo ?? ""}
              {r.imdbRating ? ` / ${r.imdbRating}` : ""}
            </div>
          </div>
          <span class="result-arrow"><ChevronIcon /></span>
        </div>
      ))}
    </div>
  );
});
