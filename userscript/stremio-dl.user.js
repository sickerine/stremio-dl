// ==UserScript==
// @name         Stremio Download Manager
// @namespace    https://github.com/stremiocli
// @version      1.0.0
// @description  Adds batch season download to Stremio Web via stremio-dl server
// @author       stremiocli
// @match        https://app.strem.io/*
// @match        https://web.stremio.com/*
// @match        http://localhost:11470/*
// @match        http://127.0.0.1:11470/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  "use strict";

  const SERVER_PORT = GM_getValue("serverPort", 9944);
  const SERVER_URL = `http://localhost:${SERVER_PORT}`;

  // ── Styles ─────────────────────────────────────────────────────────────

  GM_addStyle(`
    .sdl-btn {
      background: #7b5bf5;
      color: #fff;
      border: none;
      border-radius: 6px;
      padding: 8px 16px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: background 0.2s, opacity 0.2s;
      font-family: inherit;
    }
    .sdl-btn:hover { background: #6a4be0; }
    .sdl-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .sdl-btn--sm { padding: 5px 10px; font-size: 12px; }
    .sdl-btn--danger { background: #e04b4b; }
    .sdl-btn--danger:hover { background: #c93c3c; }
    .sdl-btn--ghost { background: transparent; color: #7b5bf5; border: 1px solid #7b5bf5; }
    .sdl-btn--ghost:hover { background: rgba(123, 91, 245, 0.1); }

    .sdl-panel {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 380px;
      max-height: 500px;
      background: #1a1a2e;
      border: 1px solid #333;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.5);
      z-index: 99999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #e0e0e0;
    }
    .sdl-panel--hidden { display: none; }
    .sdl-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #16163a;
      border-bottom: 1px solid #333;
    }
    .sdl-panel-header h3 {
      margin: 0;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
    }
    .sdl-panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .sdl-panel-body::-webkit-scrollbar { width: 6px; }
    .sdl-panel-body::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }

    .sdl-job {
      background: #222244;
      border-radius: 8px;
      padding: 10px 12px;
      margin-bottom: 8px;
    }
    .sdl-job-title {
      font-size: 13px;
      font-weight: 600;
      color: #fff;
      margin-bottom: 4px;
    }
    .sdl-job-meta {
      font-size: 11px;
      color: #888;
      margin-bottom: 6px;
    }
    .sdl-job-progress {
      height: 4px;
      background: #333;
      border-radius: 2px;
      overflow: hidden;
    }
    .sdl-job-progress-bar {
      height: 100%;
      background: #7b5bf5;
      border-radius: 2px;
      transition: width 0.3s;
    }
    .sdl-job-progress-bar--done { background: #4caf50; }
    .sdl-job-progress-bar--fail { background: #e04b4b; }
    .sdl-job-status {
      font-size: 11px;
      margin-top: 4px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .sdl-status-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      display: inline-block;
      margin-right: 4px;
    }
    .sdl-status-dot--queued { background: #888; }
    .sdl-status-dot--resolving { background: #f5a623; }
    .sdl-status-dot--downloading { background: #7b5bf5; }
    .sdl-status-dot--completed { background: #4caf50; }
    .sdl-status-dot--failed { background: #e04b4b; }

    .sdl-toggle {
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 48px;
      height: 48px;
      background: #7b5bf5;
      border: none;
      border-radius: 50%;
      color: #fff;
      font-size: 20px;
      cursor: pointer;
      box-shadow: 0 4px 16px rgba(123, 91, 245, 0.4);
      z-index: 99998;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }
    .sdl-toggle:hover { transform: scale(1.1); }
    .sdl-toggle--hidden { display: none; }
    .sdl-badge {
      position: absolute;
      top: -4px; right: -4px;
      background: #e04b4b;
      color: #fff;
      font-size: 10px;
      font-weight: 700;
      width: 18px; height: 18px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .sdl-empty {
      text-align: center;
      padding: 24px;
      color: #666;
      font-size: 13px;
    }

    .sdl-server-err {
      background: #2a1a1a;
      border: 1px solid #e04b4b33;
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 8px;
      text-align: center;
    }
    .sdl-server-err p { margin: 4px 0; font-size: 12px; color: #e04b4b; }
    .sdl-server-err code { font-size: 11px; color: #888; }

    .sdl-inline-btn {
      margin-left: 8px;
    }
  `);

  // ── API Helpers ────────────────────────────────────────────────────────

  function api(method, path, data) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method,
        url: `${SERVER_URL}${path}`,
        headers: { "Content-Type": "application/json" },
        data: data ? JSON.stringify(data) : undefined,
        onload(res) {
          try {
            resolve(JSON.parse(res.responseText));
          } catch {
            resolve(res.responseText);
          }
        },
        onerror(err) {
          reject(new Error("Server unreachable"));
        },
      });
    });
  }

  // ── UI Components ─────────────────────────────────────────────────────

  let panelVisible = false;
  let serverOnline = false;
  let pollInterval = null;

  function createPanel() {
    const panel = document.createElement("div");
    panel.className = "sdl-panel sdl-panel--hidden";
    panel.id = "sdl-panel";
    panel.innerHTML = `
      <div class="sdl-panel-header">
        <h3>Stremio Downloads</h3>
        <div>
          <button class="sdl-btn sdl-btn--sm sdl-btn--ghost" id="sdl-refresh">Refresh</button>
          <button class="sdl-btn sdl-btn--sm sdl-btn--ghost" id="sdl-close">X</button>
        </div>
      </div>
      <div class="sdl-panel-body" id="sdl-jobs"></div>
    `;
    document.body.appendChild(panel);

    const toggle = document.createElement("button");
    toggle.className = "sdl-toggle";
    toggle.id = "sdl-toggle";
    toggle.innerHTML = `<span style="font-size:18px">DL</span>`;
    document.body.appendChild(toggle);

    toggle.addEventListener("click", () => togglePanel());
    panel.querySelector("#sdl-close").addEventListener("click", () => togglePanel());
    panel.querySelector("#sdl-refresh").addEventListener("click", () => refreshJobs());
  }

  function togglePanel() {
    panelVisible = !panelVisible;
    document.getElementById("sdl-panel").classList.toggle("sdl-panel--hidden", !panelVisible);
    document.getElementById("sdl-toggle").classList.toggle("sdl-toggle--hidden", panelVisible);
    if (panelVisible) refreshJobs();
  }

  async function refreshJobs() {
    const container = document.getElementById("sdl-jobs");
    try {
      const data = await api("GET", "/api/jobs");
      serverOnline = true;
      if (!data.jobs || data.jobs.length === 0) {
        container.innerHTML = `<div class="sdl-empty">No download jobs yet.<br><br>Use the download button on a series page to start.</div>`;
        return;
      }
      container.innerHTML = data.jobs.map(renderJob).join("");

      // Bind delete buttons
      container.querySelectorAll("[data-delete-job]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api("DELETE", `/api/jobs/${btn.dataset.deleteJob}`);
          refreshJobs();
        });
      });

      // Update badge
      const active = data.jobs.filter((j) => j.status === "downloading" || j.status === "resolving").length;
      updateBadge(active);
    } catch {
      serverOnline = false;
      container.innerHTML = `
        <div class="sdl-server-err">
          <p>Server not running</p>
          <code>stremio-dl serve</code>
        </div>
      `;
    }
  }

  function renderJob(job) {
    const statusClass = `sdl-status-dot--${job.status}`;
    const barClass =
      job.status === "completed" ? "sdl-job-progress-bar--done" :
      job.status === "failed" ? "sdl-job-progress-bar--fail" : "";

    return `
      <div class="sdl-job">
        <div class="sdl-job-title">${esc(job.seriesName || job.imdbId)} S${String(job.season).padStart(2, "0")}</div>
        <div class="sdl-job-meta">${job.quality} | ${job.backend} | ${job.totalEpisodes} eps</div>
        <div class="sdl-job-progress">
          <div class="sdl-job-progress-bar ${barClass}" style="width:${job.progress}%"></div>
        </div>
        <div class="sdl-job-status">
          <span><span class="sdl-status-dot ${statusClass}"></span>${job.status}${job.error ? ": " + esc(job.error.substring(0, 50)) : ""}</span>
          <button class="sdl-btn sdl-btn--sm sdl-btn--danger" data-delete-job="${job.id}">X</button>
        </div>
      </div>
    `;
  }

  function updateBadge(count) {
    const toggle = document.getElementById("sdl-toggle");
    let badge = toggle.querySelector(".sdl-badge");
    if (count > 0) {
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "sdl-badge";
        toggle.appendChild(badge);
      }
      badge.textContent = count;
    } else if (badge) {
      badge.remove();
    }
  }

  function esc(str) {
    const el = document.createElement("span");
    el.textContent = str;
    return el.innerHTML;
  }

  // ── Download Button Injection ─────────────────────────────────────────

  function extractImdbId() {
    const hash = window.location.hash;
    // Stremio Web URL patterns:
    // #/detail/series/tt0903747
    // #/detail/series/tt0903747:1:1
    // #/detail/movie/tt1375666
    const match = hash.match(/\/detail\/(?:series|movie)\/(tt\d+)/);
    return match ? match[1] : null;
  }

  function extractContentType() {
    const hash = window.location.hash;
    if (hash.includes("/detail/series/")) return "series";
    if (hash.includes("/detail/movie/")) return "movie";
    return null;
  }

  let lastInjectedId = null;

  async function injectDownloadButton() {
    const imdbId = extractImdbId();
    const type = extractContentType();
    if (!imdbId || type !== "series") {
      lastInjectedId = null;
      return;
    }
    if (lastInjectedId === imdbId) return;
    lastInjectedId = imdbId;

    // Wait for the page to render
    await new Promise((r) => setTimeout(r, 800));

    // Find the action buttons area in the detail page
    // Stremio Web uses various class names - try multiple selectors
    const selectors = [
      ".action-buttons-container",
      ".buttons-bar-container",
      "[class*='action-buttons']",
      "[class*='buttons-bar']",
      "[class*='ActionButtons']",
      "[class*='action-bar']",
    ];

    let container = null;
    for (const sel of selectors) {
      container = document.querySelector(sel);
      if (container) break;
    }

    // Fallback: find any container near the play button
    if (!container) {
      const playBtn = document.querySelector("[class*='play-button'], [class*='PlayButton'], button[title*='Play']");
      if (playBtn) container = playBtn.parentElement;
    }

    // Another fallback: look for the meta info section
    if (!container) {
      const metaInfo = document.querySelector("[class*='meta-info'], [class*='MetaInfo'], [class*='detail-info']");
      if (metaInfo) container = metaInfo;
    }

    if (!container) return;

    // Remove existing button if any
    document.querySelectorAll(".sdl-inject-btn").forEach((el) => el.remove());

    const btn = document.createElement("button");
    btn.className = "sdl-btn sdl-inject-btn sdl-inline-btn";
    btn.textContent = "Download Season";
    btn.addEventListener("click", () => showSeasonPicker(imdbId));
    container.appendChild(btn);
  }

  async function showSeasonPicker(imdbId) {
    try {
      const data = await api("GET", `/api/meta/${imdbId}`);
      if (!data.seasons || data.seasons.length === 0) {
        alert("No seasons found");
        return;
      }

      const season = data.seasons.length === 1
        ? data.seasons[0].number
        : parseInt(
            prompt(
              `${data.name}\n\nAvailable seasons: ${data.seasons.map((s) => `S${String(s.number).padStart(2, "0")} (${s.episodes.length} eps)`).join(", ")}\n\nEnter season number:`,
              String(data.seasons[0].number),
            ),
            10,
          );

      if (isNaN(season)) return;

      const result = await api("POST", "/api/download", {
        imdbId,
        season,
      });

      if (result.error) {
        alert(`Error: ${result.error}`);
        return;
      }

      // Open panel to show progress
      if (!panelVisible) togglePanel();
      refreshJobs();
    } catch {
      alert("stremio-dl server not running.\n\nStart it with:\n  stremio-dl serve");
    }
  }

  // ── Initialization ────────────────────────────────────────────────────

  createPanel();

  // Poll for job updates when panel is open
  setInterval(() => {
    if (panelVisible) refreshJobs();
  }, 3000);

  // Watch for navigation changes (Stremio uses hash routing)
  let lastHash = window.location.hash;
  setInterval(() => {
    if (window.location.hash !== lastHash) {
      lastHash = window.location.hash;
      injectDownloadButton();
    }
  }, 500);

  // Initial injection
  setTimeout(injectDownloadButton, 1500);
})();
