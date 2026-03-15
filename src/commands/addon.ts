import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { parseAddonUrl } from "../api/addon.js";
import { config } from "../config.js";

export const addonCommand = new Command("addon")
  .description("Manage stream addon configuration");

addonCommand
  .command("set")
  .description("Set the stream addon URL (supports Stremio share links, StremThru wrap URLs)")
  .argument("<url>", "Addon URL or Stremio share link")
  .action(async (rawUrl: string) => {
    const parsed = parseAddonUrl(rawUrl);

    // Validate by fetching the manifest
    const spinner = ora("Validating addon...").start();
    try {
      const res = await fetch(`${parsed}/manifest.json`, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const manifest = await res.json() as { name?: string; id?: string; version?: string };
      config.set("addons.streamUrl", parsed);

      const name = manifest.name ?? "Unknown";
      const id = manifest.id ?? "";
      const version = manifest.version ?? "";
      spinner.succeed(`Addon set: ${pc.bold(name)} ${pc.dim(`(${id} v${version})`)}`);

      if (parsed.includes("/stremio/wrap/")) {
        console.log(pc.green("  StremThru Wrap detected — direct download mode will be used automatically"));
      } else if (parsed.includes("/stremio/store/")) {
        console.log(pc.green("  StremThru Store detected — direct download mode will be used automatically"));
      }

      console.log(pc.dim(`  URL: ${parsed}`));
    } catch (err) {
      spinner.fail("Failed to validate addon");
      console.error(pc.red(`  Could not fetch manifest from: ${parsed}/manifest.json`));
      console.error(pc.red(`  Error: ${err}`));
      console.log(pc.dim("\n  Make sure the URL is correct and the addon is reachable."));
      console.log(pc.dim("  Examples:"));
      console.log(pc.dim("    stremio-dl addon set https://torrentio.strem.fun"));
      console.log(pc.dim("    stremio-dl addon set stremio://your-stremthru.com/stremio/wrap/{config}/manifest.json"));
      console.log(pc.dim("    stremio-dl addon set https://your-stremthru.com/stremio/wrap/{config}"));
    }
  });

addonCommand
  .command("show")
  .description("Show the current addon URL")
  .action(() => {
    const url = config.get("addons.streamUrl") as string;
    const isStremThru = url.includes("/stremio/wrap/") || url.includes("/stremio/store/");
    console.log(`Current addon: ${pc.bold(url)}`);
    if (isStremThru) {
      console.log(pc.green("  Type: StremThru (direct download mode)"));
    } else {
      console.log(pc.dim("  Type: Standard Stremio addon (requires debrid/torrent backend)"));
    }
  });

addonCommand
  .command("reset")
  .description("Reset to default Torrentio addon")
  .action(() => {
    config.set("addons.streamUrl", "https://torrentio.strem.fun");
    console.log(pc.green("Addon reset to: https://torrentio.strem.fun"));
  });
