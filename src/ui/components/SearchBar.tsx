import { h } from "preact";
import { memo } from "preact/compat";
import { useRef, useCallback, useEffect } from "preact/hooks";

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export const SearchBar = memo(function SearchBar({ onSearch, loading }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" && inputRef.current) {
      const q = inputRef.current.value.trim();
      if (q) onSearch(q);
    }
  }, [onSearch]);

  return (
    <div class={`search-bar${loading ? " search-loading" : ""}`}>
      <span class="search-label">{loading ? "..." : "Search"}</span>
      <input
        ref={inputRef}
        class="search-input"
        placeholder={loading ? "Searching..." : "Series or movie..."}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
});
