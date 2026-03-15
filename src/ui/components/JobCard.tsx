import { h } from "preact";
import type { Job } from "../types";
import { TrashIcon } from "./Icons";
import { pad } from "../lib/utils";

function formatSpeed(mbps: number): string {
  if (mbps <= 0) return "";
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps * 1024).toFixed(0)} KB/s`;
}

function formatMB(mb: number): string {
  if (mb <= 0) return "";
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}G`;
  if (mb >= 1) return `${mb.toFixed(0)}M`;
  return `${(mb * 1024).toFixed(0)}K`;
}

interface JobCardProps {
  job: Job;
  onDelete: (id: string) => void;
}

export function JobCard({ job, onDelete }: JobCardProps) {
  const totalSpeed = job.totalSpeedMBps ?? 0;
  const eps = job.episodeProgress ?? [];
  const totalDownloadedMB = eps.reduce((s, e) => s + (e.downloadedMB ?? 0), 0);
  const totalSizeMB = eps.reduce((s, e) => s + (e.totalMB ?? 0), 0);

  const pctText = job.status === "completed" ? "DONE"
    : job.status === "failed" ? "FAIL"
    : job.status === "resolving" ? "..."
    : `${job.progress}%`;

  const pctClass = job.status === "completed" ? "done"
    : job.status === "failed" ? "fail"
    : job.status === "resolving" ? "resolving"
    : "";

  return (
    <div class="job">
      <div class="job-top">
        <div>
          <div class="job-name">
            {job.seriesName || job.imdbId}
            {job.season > 0 ? <small>S{pad(job.season)}</small> : null}
          </div>
          <div class="job-info">
            <span>{job.quality}</span>
            <span>{job.backend}</span>
            <span>{job.totalEpisodes} {job.totalEpisodes === 1 ? "file" : "ep"}</span>
            {totalSizeMB > 0 ? (
              <span>{formatMB(totalDownloadedMB)}/{formatMB(totalSizeMB)}</span>
            ) : null}
            {job.status === "downloading" && totalSpeed > 0 ? (
              <span class="job-speed-total">{formatSpeed(totalSpeed)}</span>
            ) : null}
          </div>
        </div>
        <div class="job-right">
          <div class={`job-pct ${pctClass}`}>{pctText}</div>
          <button class="btn-danger btn-sm" onClick={() => onDelete(job.id)}>
            <TrashIcon />
          </button>
        </div>
      </div>

      <div class="bar">
        <div class={`bar-fill ${job.status}`} style={`width:${job.progress}%`} />
      </div>

      {eps.length > 0 ? (
        <div class="ep-grid">
          {eps.map((ep) => {
            const pct = ep.status === "completed" ? 100 : Math.round(ep.percent);
            const speed = ep.speedMBps ?? 0;
            const size = ep.totalMB ?? 0;
            const color =
              ep.status === "completed" ? "var(--green)" :
              ep.status === "downloading" ? "var(--accent)" :
              ep.status === "failed" ? "#f55" :
              "rgba(255,255,255,0.04)";
            return (
              <div key={ep.episode} class="ep-row">
                <span class="ep-num">{pad(ep.episode)}</span>
                <div class="ep-track">
                  <div class="ep-track-fill" style={`width:${pct}%;background:${color}`} />
                </div>
                <span class="ep-size">{size > 0 ? formatMB(size) : ""}</span>
                <span class="ep-speed">
                  {ep.status === "downloading" && speed > 0 ? formatSpeed(speed) : ""}
                </span>
                <span class={`ep-pct${ep.status === "completed" ? " done" : ""}`}>{pct}%</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {job.error ? <div class="job-alert error">{job.error}</div> : null}
      {job.outputDir ? <div class="job-alert success">{job.outputDir}</div> : null}
    </div>
  );
}
