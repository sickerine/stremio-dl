import { h } from "preact";
import { memo } from "preact/compat";
import type { Tab } from "../types";

interface TopbarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  activeCount: number;
  globalSpeed: number;
  updateAvailable: string | null;
}

function formatSpeed(mbps: number): string {
  if (mbps <= 0) return "";
  if (mbps >= 1) return `${mbps.toFixed(1)} MB/s`;
  return `${(mbps * 1024).toFixed(0)} KB/s`;
}

export const Topbar = memo(function Topbar({ tab, onTabChange, activeCount, globalSpeed, updateAvailable }: TopbarProps) {
  return (
    <div class="header">
      <div class="header-left">
        <button class="header-brand" onClick={() => onTabChange("home")} style="cursor:pointer;background:none;border:none">
          Stremio<span>/</span>DL
        </button>
        <span class="header-version">v{window.__VERSION__}</span>
        {globalSpeed > 0 ? (
          <span class="header-speed">{formatSpeed(globalSpeed)}</span>
        ) : null}
        {updateAvailable ? (
          <a
            class="header-update"
            href="https://github.com/sickerine/stremio-dl/releases/latest"
            target="_blank"
            rel="noopener"
          >
            v{updateAvailable} available
          </a>
        ) : null}
      </div>
      <div class="nav">
        <button
          class={`nav-link${tab === "home" ? " active" : ""}`}
          onClick={() => onTabChange("home")}
        >
          Home
          {activeCount > 0 ? <span class="nav-count">{activeCount}</span> : null}
        </button>
        <button
          class={`nav-link${tab === "settings" ? " active" : ""}`}
          onClick={() => onTabChange("settings")}
        >
          Config
        </button>
      </div>
    </div>
  );
});
