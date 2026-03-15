import { h, Fragment } from "preact";
import { useState, useEffect, useCallback, useRef } from "preact/hooks";
import { api } from "../lib/api";
import { useAbortController } from "../hooks/useAbortController";
import { pad } from "../lib/utils";
import type { SeriesMeta, Estimate } from "../types";

interface DownloadModalProps {
  meta: SeriesMeta;
  initialSeason?: number;
  onDownloadStarted: () => void;
  onClose: () => void;
}

export function DownloadModal({ meta, initialSeason, onDownloadStarted, onClose }: DownloadModalProps) {
  const isMovie = meta.type === "movie";
  const [selSeason, setSelSeason] = useState(isMovie ? 0 : (initialSeason ?? meta.seasons?.[0]?.number ?? 1));
  const [selQuality, setSelQuality] = useState<"1080p" | "2160p">("1080p");
  const [webdlOnly, setWebdlOnly] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);
  const [estimating, setEstimating] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const estimateAc = useAbortController();
  const qualityRef = useRef(selQuality);
  const webdlRef = useRef(webdlOnly);
  const seasonRef = useRef(selSeason);
  qualityRef.current = selQuality;
  webdlRef.current = webdlOnly;
  seasonRef.current = selSeason;

  const fetchEstimate = useCallback(async () => {
    const signal = estimateAc.next();
    const quality = qualityRef.current;
    const webdl = webdlRef.current;
    const season = seasonRef.current;
    setEstimate(null);
    setEstimating(true);
    setError(null);
    const ex = quality === "1080p" ? "60fps" : "";
    const rq = webdl ? "webdl" : "";
    const typeParam = isMovie ? "&type=movie" : "";
    const seasonParam = isMovie ? "" : `&season=${season}`;
    try {
      const data = await api<Estimate>("GET", `/api/estimate?imdbId=${meta.id}${seasonParam}${typeParam}&quality=${quality}&exclude=${ex}&require=${rq}`, undefined, signal);
      setEstimate(data);
    } catch (e: unknown) {
      if ((e as Error).name === "AbortError") return;
      setEstimate(null);
      setError(`Estimate failed: ${(e as Error).message}`);
    } finally {
      setEstimating(false);
    }
  }, [meta.id, isMovie, estimateAc]);

  useEffect(() => { fetchEstimate(); }, [selSeason, selQuality, webdlOnly, fetchEstimate]);
  useEffect(() => () => estimateAc.abort(), [estimateAc]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      await api("POST", "/api/download", {
        imdbId: meta.id,
        type: isMovie ? "movie" : "series",
        season: isMovie ? undefined : selSeason,
        quality: selQuality,
        exclude: selQuality === "1080p" ? ["60fps"] : [],
        require: webdlOnly ? ["webdl"] : [],
      });
      onDownloadStarted();
    } catch (e: unknown) {
      setError(`Download failed: ${(e as Error).message}`);
    } finally {
      setDownloading(false);
    }
  }, [meta.id, isMovie, selSeason, selQuality, webdlOnly, onDownloadStarted]);

  const subtitle = isMovie ? "Movie download" : "Select season & quality";
  const dlLabel = isMovie
    ? `Download${estimate && estimate.totalBytes > 0 ? ` — ${estimate.totalFormatted}` : ""}`
    : `Download S${pad(selSeason)}${estimate && estimate.totalBytes > 0 ? ` — ${estimate.totalFormatted}` : ""}`;

  return (
    <div class="overlay" onClick={onClose}>
      <div class="modal" onClick={(e: Event) => e.stopPropagation()}>
        <div class="modal-head">
          <div class="modal-title">{meta.name}</div>
          <div class="modal-sub">{subtitle}</div>
        </div>

        <div class="modal-body">
          {!isMovie && meta.seasons && meta.seasons.length > 0 ? (
            <div class="chip-row">
              {meta.seasons.map((s) => (
                <button key={s.number} class={`chip${selSeason === s.number ? " sel" : ""}`} onClick={() => setSelSeason(s.number)}>
                  S{pad(s.number)} ({s.episodes.length})
                </button>
              ))}
            </div>
          ) : null}

          <div class="qual-row">
            <button class={`qual-btn${selQuality === "1080p" ? " sel" : ""}`} onClick={() => setSelQuality("1080p")}>
              1080P<small>No 60fps</small>
            </button>
            <button class={`qual-btn${selQuality === "2160p" ? " sel" : ""}`} onClick={() => setSelQuality("2160p")}>
              4K<small>Best quality</small>
            </button>
          </div>

          <div class="toggle-row">
            <label class="toggle-label">
              <input type="checkbox" class="toggle-track" checked={webdlOnly} onChange={(e: Event) => setWebdlOnly((e.target as HTMLInputElement).checked)} />
              WEB-DL only
            </label>
          </div>

          <div class="estimate">
            {estimating ? (
              <EstimateLoader />
            ) : estimate && estimate.totalBytes > 0 ? (
              <Fragment>
                <div class="estimate-head">
                  <span class="estimate-total">{estimate.totalFormatted}</span>
                  <span class="estimate-count">{estimate.resolved}/{estimate.totalEpisodes} {isMovie ? "file" : "ep"}</span>
                </div>
                {(estimate.breakdown ?? []).map((ep) => (
                  <div key={ep.episode} class="estimate-row">
                    <span>{isMovie ? ep.name.substring(0, 36) : `${pad(ep.episode)} ${ep.name.substring(0, 28)}`}</span>
                    <span>{ep.bytes > 0 ? ep.size : "--"}</span>
                  </div>
                ))}
              </Fragment>
            ) : estimate ? (
              <div class="estimate-empty">No streams found</div>
            ) : (
              <EstimateLoader />
            )}
          </div>

          {error ? <div class="alert alert-error">{error}</div> : null}
        </div>

        <div class="modal-footer">
          <button class="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            class="btn btn-primary"
            onClick={handleDownload}
            disabled={downloading || (estimate !== null && estimate.totalBytes === 0)}
          >
            {downloading ? "Starting..." : dlLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function EstimateLoader() {
  return (
    <div class="est-loader">
      <div class="est-loader-scan" />
      <div class="est-loader-label">
        Resolving<span class="est-loader-cursor" />
      </div>
      <div class="est-loader-bars">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} class="est-loader-bar" style={`animation-delay:${i * 0.15}s`} />
        ))}
      </div>
      <div class="est-loader-status">Querying streams</div>
    </div>
  );
}
