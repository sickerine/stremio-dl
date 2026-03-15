import { h } from "preact";
import { memo } from "preact/compat";
import type { Tab } from "../types";

interface TopbarProps {
  tab: Tab;
  onTabChange: (tab: Tab) => void;
  activeCount: number;
}

export const Topbar = memo(function Topbar({ tab, onTabChange, activeCount }: TopbarProps) {
  return (
    <div class="header">
      <button class="header-brand" onClick={() => onTabChange("home")} style="cursor:pointer;background:none;border:none">
        Stremio<span>/</span>DL
      </button>
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
