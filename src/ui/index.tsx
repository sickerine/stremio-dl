import { h, render } from "preact";
import { useState, useEffect, useCallback, useMemo, useRef } from "preact/hooks";
import { Topbar } from "./components/Topbar";
import { SearchBar } from "./components/SearchBar";
import { DownloadsView } from "./components/DownloadsView";
import { SearchResults } from "./components/SearchResults";
import { SettingsView } from "./components/SettingsView";
import { DownloadModal } from "./components/DownloadModal";
import { api } from "./lib/api";
import { useAbortController } from "./hooks/useAbortController";
import { usePolling } from "./hooks/usePolling";
import type { Tab, Job, SearchResult, SeriesMeta } from "./types";

declare global {
  interface Window {
    __PORT__: number;
    __VERSION__: string;
  }
}

const initParams = new URLSearchParams(window.location.search);
const INIT_DOWNLOAD_ID = initParams.get("download");
const INIT_SEASON = parseInt(initParams.get("season") ?? "0", 10);
const INIT_JOB_ID = initParams.get("job");
if (INIT_DOWNLOAD_ID || INIT_JOB_ID) {
  window.history.replaceState({}, "", "/");
}

function App() {
  const [tab, setTab] = useState<Tab>("home");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [modalMeta, setModalMeta] = useState<SeriesMeta | null>(null);
  const [modalInitSeason, setModalInitSeason] = useState<number | undefined>(undefined);
  const [searchLoading, setSearchLoading] = useState(false);
  const [metaLoading, setMetaLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const searchAc = useAbortController();
  const metaAc = useAbortController();

  // ── Job polling (always on, slower when not on home) ───
  const pollJobs = useCallback(async (signal: AbortSignal) => {
    const data = await api<{ jobs: Job[] }>("GET", "/api/jobs", undefined, signal);
    setJobs(data.jobs ?? []);
  }, []);

  usePolling(pollJobs, tab === "home" ? 2000 : 10000, true);

  const activeCount = useMemo(
    () => jobs.filter((j) => j.status === "downloading" || j.status === "resolving").length,
    [jobs],
  );

  const globalSpeed = useMemo(
    () => jobs.reduce((sum, j) => sum + (j.totalSpeedMBps ?? 0), 0),
    [jobs],
  );

  // ── URL param init ─────────────────────────────────────
  const initRan = useRef(false);
  useEffect(() => {
    if (initRan.current || !INIT_DOWNLOAD_ID) return;
    initRan.current = true;
    setMetaLoading(true);
    api<SeriesMeta>("GET", `/api/meta/${INIT_DOWNLOAD_ID}`)
      .then((data) => { setModalInitSeason(INIT_SEASON); setModalMeta(data); })
      .catch((e) => { setSearchError(`Failed to load: ${(e as Error).message}`); })
      .finally(() => setMetaLoading(false));
  }, []);

  // ── Search ─────────────────────────────────────────────
  const search = useCallback(async (q: string) => {
    if (!q.trim()) return;
    const signal = searchAc.next();
    setSearchLoading(true);
    setSearchError(null);
    try {
      const data = await api<{ results: SearchResult[] }>("GET", `/api/search?q=${encodeURIComponent(q.trim())}`, undefined, signal);
      setResults(data.results ?? []);
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      setSearchError((e as Error).message);
    } finally {
      if (!signal.aborted) setSearchLoading(false);
    }
  }, [searchAc]);

  // ── Open modal ─────────────────────────────────────────
  const openMeta = useCallback(async (id: string) => {
    const signal = metaAc.next();
    setMetaLoading(true);
    try {
      const data = await api<SeriesMeta>("GET", `/api/meta/${id}`, undefined, signal);
      setModalInitSeason(undefined);
      setModalMeta(data);
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      setSearchError(`Failed to load metadata: ${(e as Error).message}`);
    } finally {
      if (!signal.aborted) setMetaLoading(false);
    }
  }, [metaAc]);

  // ── Download started (from modal) — keep results ──────
  const onDownloadStarted = useCallback(() => {
    setModalMeta(null);
  }, []);

  // ── Delete job ─────────────────────────────────────────
  const deleteJob = useCallback(async (id: string) => {
    try {
      await api("DELETE", `/api/jobs/${id}`);
      setJobs((prev) => prev.filter((j) => j.id !== id));
    } catch (e: unknown) {
      console.error("Failed to delete job:", e);
    }
  }, []);

  const handleTabChange = useCallback((t: Tab) => { setTab(t); }, []);
  const closeModal = useCallback(() => setModalMeta(null), []);

  return (
    <div>
      <div class="shell">
        <Topbar
          tab={tab}
          onTabChange={handleTabChange}
          activeCount={activeCount}
          globalSpeed={globalSpeed}
        />
        <div class="main">
          {tab === "home" ? (
            <div class="home-layout">
              <div class="home-left">
                <SearchBar onSearch={search} loading={searchLoading} />
                {searchError ? <div class="alert alert-error">{searchError}</div> : null}
                <SearchResults results={results} onSelect={openMeta} loading={metaLoading} />
              </div>
              <div class="home-right">
                <div class="panel-label">Downloads</div>
                <DownloadsView
                  jobs={jobs}
                  onDelete={deleteJob}
                  initialFocusJob={INIT_JOB_ID}
                />
              </div>
            </div>
          ) : (
            <div class="container">
              <SettingsView />
            </div>
          )}
        </div>
      </div>
      {modalMeta ? (
        <DownloadModal
          meta={modalMeta}
          initialSeason={modalInitSeason}
          onDownloadStarted={onDownloadStarted}
          onClose={closeModal}
        />
      ) : null}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
