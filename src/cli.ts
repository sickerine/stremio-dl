#!/usr/bin/env node
import { Command } from "commander";
import { exec } from "node:child_process";
import { searchCommand } from "./commands/search.js";
import { downloadCommand } from "./commands/download.js";
import { configCommand } from "./commands/config-cmd.js";
import { addonCommand } from "./commands/addon.js";
import { serveCommand } from "./commands/serve.js";
import { startServer } from "./server.js";

const PORT = 9944;

function openBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  exec(`${cmd} "${url}"`);
}

async function isPortTaken(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`);
    return res.ok;
  } catch {
    return false;
  }
}

const program = new Command()
  .name("stremio-dl")
  .description("Download series and movies from Stremio addons")
  .version("1.0.0");

program.addCommand(searchCommand);
program.addCommand(downloadCommand);
program.addCommand(configCommand);
program.addCommand(addonCommand);
program.addCommand(serveCommand);

// Default action: no subcommand → serve + open browser
program.action(async () => {
  const taken = await isPortTaken(PORT);
  if (taken) {
    console.log(`Server already running, opening browser...`);
    openBrowser(`http://localhost:${PORT}`);
  } else {
    startServer(PORT, true);
  }
});

program.parse();
