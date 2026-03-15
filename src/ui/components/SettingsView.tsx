import { h } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import { api } from "../lib/api";
import type { Config } from "../types";

export function SettingsView() {
  const [config, setConfig] = useState<Config | null>(null);
  const [addonDraft, setAddonDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<Config>("GET", "/api/config")
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setAddonDraft(data.addonUrl);
        }
      })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, []);

  const dirty = config !== null && addonDraft !== config.addonUrl;

  const saveAddon = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await api<Config>("POST", "/api/config", { addonUrl: addonDraft });
      setConfig(data);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [addonDraft]);

  const pickFolder = useCallback(async () => {
    try {
      const r = await api<{ folder: string }>("POST", "/api/pick-folder");
      if (r.folder) {
        await api<Config>("POST", "/api/config", { outputDir: r.folder });
        setConfig((prev) => prev ? { ...prev, outputDir: r.folder } : prev);
      }
    } catch (e: unknown) {
      setError(`Folder picker failed: ${(e as Error).message}`);
    }
  }, []);

  if (error && !config) {
    return (
      <div class="empty">
        <div class="empty-label">Error</div>
        <div class="empty-desc">{error}</div>
      </div>
    );
  }

  if (!config) {
    return (
      <div class="empty">
        <div class="empty-label" style="animation:pulse 1.8s ease infinite">Loading<span class="est-loader-cursor" /></div>
      </div>
    );
  }

  return (
    <div>
      <div class="addon-bar">
        <div>
          <div style="font-family:'JetBrains Mono',monospace;font-size:10px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">
            Stremio Addon
          </div>
          <code>http://127.0.0.1:{window.__PORT__}/manifest.json</code>
        </div>
        <a
          href={`stremio://127.0.0.1:${window.__PORT__}/manifest.json`}
          class="btn btn-primary btn-sm"
          style="text-decoration:none"
        >
          Install
        </a>
      </div>

      <div class="settings-section">
        <div class="settings-label">Source</div>
        <div class="settings-row">
          <span class="settings-key">Addon</span>
          <input
            class="settings-val"
            value={addonDraft}
            placeholder="Stream addon URL"
            onInput={(e: Event) => setAddonDraft((e.target as HTMLInputElement).value)}
            onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" && dirty) saveAddon(); }}
          />
          {dirty ? (
            <button class="btn btn-primary btn-sm" onClick={saveAddon} disabled={saving}>
              {saving ? "..." : "Save"}
            </button>
          ) : null}
        </div>
        {error ? <div class="alert alert-error" style="margin-top:8px">{error}</div> : null}
      </div>

      <div class="settings-section">
        <div class="settings-label">Storage</div>
        <div class="settings-row">
          <span class="settings-key">Output</span>
          <input class="settings-val" value={config.outputDir} readOnly style="cursor:pointer" onClick={pickFolder} />
          <button class="btn btn-ghost btn-sm" onClick={pickFolder}>Browse</button>
        </div>
      </div>
    </div>
  );
}
