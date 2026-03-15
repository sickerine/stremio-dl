import { h } from "preact";
import { memo } from "preact/compat";
import { useRef, useCallback } from "preact/hooks";

interface SearchBarProps {
  onSearch: (query: string) => void;
  loading?: boolean;
}

export const SearchBar = memo(function SearchBar({ onSearch, loading }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Enter" && inputRef.current) {
      onSearch(inputRef.current.value);
    }
  }, [onSearch]);

  return (
    <div class={`search-bar${loading ? " pulse" : ""}`}>
      <span class="search-label">Search</span>
      <input
        ref={inputRef}
        class="search-input"
        placeholder="Series name..."
        onKeyDown={handleKeyDown}
      />
    </div>
  );
});
