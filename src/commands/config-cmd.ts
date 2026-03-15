import { Command } from "commander";
import pc from "picocolors";
import { config } from "../config.js";

export const configCommand = new Command("config")
  .description("Manage configuration");

configCommand
  .command("set")
  .description("Set a config value")
  .argument("<key>", "Config key (e.g., debrid.apiKey, download.outputDir)")
  .argument("<value>", "Config value")
  .action((key: string, value: string) => {
    try {
      // Handle numeric values
      const numericKeys = ["download.maxConcurrent"];
      if (numericKeys.includes(key)) {
        config.set(key as keyof typeof config.store, parseInt(value, 10) as never);
      } else {
        config.set(key as keyof typeof config.store, value as never);
      }
      console.log(pc.green(`Set ${key} = ${value}`));
    } catch (err) {
      console.error(pc.red(`Failed to set config: ${err}`));
      process.exit(1);
    }
  });

configCommand
  .command("get")
  .description("Get a config value")
  .argument("<key>", "Config key")
  .action((key: string) => {
    try {
      const value = config.get(key as keyof typeof config.store);
      console.log(`${key} = ${JSON.stringify(value, null, 2)}`);
    } catch (err) {
      console.error(pc.red(`Failed to get config: ${err}`));
      process.exit(1);
    }
  });

configCommand
  .command("show")
  .description("Show all configuration")
  .action(() => {
    console.log(pc.bold("\nCurrent configuration:\n"));
    const store = config.store;
    console.log(JSON.stringify(store, null, 2));
    console.log(pc.dim(`\nConfig file: ${config.path}`));
  });

configCommand
  .command("reset")
  .description("Reset configuration to defaults")
  .action(() => {
    config.clear();
    console.log(pc.green("Configuration reset to defaults"));
  });

configCommand
  .command("path")
  .description("Show config file path")
  .action(() => {
    console.log(config.path);
  });
