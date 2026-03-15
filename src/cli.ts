#!/usr/bin/env node
import { Command } from "commander";
import { searchCommand } from "./commands/search.js";
import { downloadCommand } from "./commands/download.js";
import { configCommand } from "./commands/config-cmd.js";
import { addonCommand } from "./commands/addon.js";
import { serveCommand } from "./commands/serve.js";

const program = new Command()
  .name("stremio-dl")
  .description("CLI tool to batch download entire seasons from Stremio addons")
  .version("1.0.0");

program.addCommand(searchCommand);
program.addCommand(downloadCommand);
program.addCommand(configCommand);
program.addCommand(addonCommand);
program.addCommand(serveCommand);

program.parse();
