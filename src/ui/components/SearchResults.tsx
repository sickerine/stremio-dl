import { h } from "preact";
import { memo } from "preact/compat";
import type { SearchResult } from "../types";
import { ChevronIcon } from "./Icons";

interface SearchResultsProps {
  results: SearchResult[];
  onSelect: (id: string) => void;
  loading?: boolean;
}

export const SearchResults = memo(function SearchResults({ results, onSelect, loading }: SearchResultsProps) {
  if (!results.length) return null;

  return (
    <div>
      <div class="panel-label" style="margin-top:8px">
        Results
        {loading ? <span class="panel-loading pulse"> Loading...</span> : null}
      </div>
      {results.map((r) => (
        <div key={r.id} class="result" onClick={() => onSelect(r.id)}>
          <div class="result-poster-wrap">
            {r.poster ? (
              <img
                class="result-poster"
                src={r.poster}
                alt=""
                loading="lazy"
                onError={(e: Event) => { (e.target as HTMLImageElement).replaceWith(Object.assign(document.createElement("div"), { className: "result-poster result-poster-fail", textContent: "?" })); }}
              />
            ) : (
              <div class="result-poster result-poster-fail">?</div>
            )}
          </div>
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
