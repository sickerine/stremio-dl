import { Command } from "commander";
import pc from "picocolors";
import ora from "ora";
import { parseAddonUrl } from "../api/addon.js";
import { config } from "../config.js";

export const addonCommand = new Command("addon")
  .description("Manage stream addon configuration");

addonCommand
  .command("set")
  .description("Set the stream addon URL")
  .argument("<url>", "Addon URL or Stremio share link")
  .action(async (rawUrl: string) => {
    const parsed = parseAddonUrl(rawUrl);

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
      console.log(pc.dim(`  URL: ${parsed}`));
    } catch (err) {
      spinner.fail("Failed to validate addon");
      console.error(pc.red(`  Could not fetch manifest from: ${parsed}/manifest.json`));
      console.error(pc.red(`  Error: ${err}`));
      console.log(pc.dim("\n  Make sure the URL is correct and the addon is reachable."));
      console.log(pc.dim("  Example:"));
      console.log(pc.dim("    stremio-dl addon set https://your-addon.example.com/manifest.json"));
    }
  });

addonCommand
  .command("show")
  .description("Show the current addon URL")
  .action(() => {
    const url = config.get("addons.streamUrl") as string;
    if (!url) {
      console.log(pc.yellow("No addon configured. Set one with: stremio-dl addon set <url>"));
    } else {
      console.log(`Current addon: ${pc.bold(url)}`);
    }
  });

addonCommand
  .command("reset")
  .description("Clear the addon URL")
  .action(() => {
    config.set("addons.streamUrl", "");
    console.log(pc.green("Addon URL cleared."));
  });
