import { h } from "preact";
import { useState } from "preact/hooks";
import type { Job } from "../types";
import { JobCard } from "./JobCard";

interface DownloadsViewProps {
  jobs: Job[];
  onDelete: (id: string) => void;
  initialFocusJob?: string | null;
}

export function DownloadsView({ jobs, onDelete, initialFocusJob }: DownloadsViewProps) {
  const [focusJob, setFocusJob] = useState<string | null>(initialFocusJob ?? null);

  const list = focusJob ? jobs.filter((j) => j.id === focusJob) : jobs;

  if (!list.length && focusJob) {
    return (
      <div class="empty">
        <div class="empty-label">Not Found</div>
        <div class="empty-desc">
          <a
            href="/"
            style="color:var(--accent);text-decoration:none"
            onClick={(e: Event) => { e.preventDefault(); setFocusJob(null); }}
          >
            View all downloads
          </a>
        </div>
      </div>
    );
  }

  if (!list.length) {
    return (
      <div class="empty">
        <div class="empty-label">Queue Empty</div>
        <div class="empty-desc">Search for a title to start downloading</div>
      </div>
    );
  }

  return (
    <div>
      {focusJob ? (
        <div style="margin-bottom:16px">
          <a
            href="/"
            style="color:var(--accent);font-size:12px;text-decoration:none;font-family:'JetBrains Mono',monospace;text-transform:uppercase;letter-spacing:0.06em"
            onClick={(e: Event) => { e.preventDefault(); setFocusJob(null); }}
          >
            &larr; All Downloads
          </a>
        </div>
      ) : null}
      {list.map((job) => (
        <JobCard key={job.id} job={job} onDelete={onDelete} />
      ))}
    </div>
  );
}
