import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { api } from "../lib/api";
import type { LibraryShow } from "../types";
import { pad } from "../lib/utils";

function formatGB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function formatFileMB(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  return `${mb}M`;
}

export function LibraryView() {
  const [library, setLibrary] = useState<LibraryShow[]>([]);
  const [outputDir, setOutputDir] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [watched, setWatched] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api<{ library: LibraryShow[]; outputDir: string }>("GET", "/api/library"),
      api<{ watched: string[] }>("GET", "/api/library/watched"),
    ]).then(([lib, w]) => {
      if (cancelled) return;
      setLibrary(lib.library);
      setOutputDir(lib.outputDir);
      setWatched(new Set(w.watched));
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const openFolder = useCallback(async (path: string) => {
    await api("POST", "/api/library/open", { path });
  }, []);

  const playFile = useCallback(async (path: string) => {
    await api("POST", "/api/library/play", { path });
    setWatched((prev) => new Set(prev).add(path));
  }, []);

  const toggleWatched = useCallback(async (path: string) => {
    const isWatched = watched.has(path);
    await api("POST", "/api/library/watched", { path, watched: !isWatched });
    setWatched((prev) => {
      const next = new Set(prev);
      if (isWatched) next.delete(path); else next.add(path);
      return next;
    });
  }, [watched]);

  if (loading) {
    return (
      <div class="empty">
        <div class="empty-label" style="animation:pulse 1.8s ease infinite">Scanning<span class="est-loader-cursor" /></div>
      </div>
    );
  }

  if (!library.length) {
    return (
      <div class="empty">
        <div class="empty-label">Empty Library</div>
        <div class="empty-desc">No media found in {outputDir || "output directory"}</div>
      </div>
    );
  }

  const totalFiles = library.reduce((s, l) => s + l.totalFiles, 0);
  const totalSizeMB = library.reduce((s, l) => s + l.totalSizeMB, 0);

  return (
    <div>
      <div class="library-header">
        <span>{library.length} {library.length === 1 ? "title" : "titles"}</span>
        <span>{totalFiles} files</span>
        <span>{formatGB(totalSizeMB)}</span>
      </div>

      {library.map((show) => {
        const isExpanded = expanded === show.name;
        const isMovie = show.seasons.length === 1 && show.seasons[0]!.number === 0;
        const allFiles = show.seasons.flatMap((s) => s.episodes.map((e) => e.filePath));
        const watchedCount = allFiles.filter((f) => watched.has(f)).length;

        return (
          <div key={show.name} class="lib-show">
            <div class="lib-show-head" onClick={() => setExpanded(isExpanded ? null : show.name)}>
              <div>
                <div class="lib-show-name">{show.name}</div>
                <div class="lib-show-meta">
                  {isMovie
                    ? `${show.totalFiles} file`
                    : `${show.seasons.length} ${show.seasons.length === 1 ? "season" : "seasons"} · ${show.totalFiles} ep`}
                  {" · "}{formatGB(show.totalSizeMB)}
                  {watchedCount > 0 ? ` · ${watchedCount}/${show.totalFiles} watched` : null}
                </div>
              </div>
              <div class="lib-show-actions">
                <button
                  class="lib-btn"
                  title="Open folder"
                  onClick={(e: Event) => { e.stopPropagation(); openFolder(show.path); }}
                >
                  Open
                </button>
                <span class={`lib-chevron${isExpanded ? " open" : ""}`}>▸</span>
              </div>
            </div>

            {isExpanded ? (
              <div class="lib-show-body">
                {show.seasons.map((season) => (
                  <div key={season.number}>
                    {!isMovie ? (
                      <div class="lib-season-label">Season {pad(season.number)}</div>
                    ) : null}
                    {season.episodes.map((ep) => {
                      const isWatched = watched.has(ep.filePath);
                      return (
                        <div key={ep.filename} class={`lib-ep-row${isWatched ? " watched" : ""}`}>
                          <button
                            class="lib-btn-play"
                            title="Play"
                            onClick={() => playFile(ep.filePath)}
                          >
                            ▶
                          </button>
                          <span class="lib-ep-name">{ep.filename}</span>
                          <span class="lib-ep-size">{formatFileMB(ep.sizeMB)}</span>
                          <button
                            class={`lib-btn-watched${isWatched ? " active" : ""}`}
                            title={isWatched ? "Mark unwatched" : "Mark watched"}
                            onClick={() => toggleWatched(ep.filePath)}
                          >
                            {isWatched ? "✓" : "○"}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
