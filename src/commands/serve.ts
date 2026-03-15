import { Command } from "commander";
import { startServer } from "../server.js";

export const serveCommand = new Command("serve")
  .description("Start the download server without opening the browser")
  .option("-p, --port <port>", "Server port", "9944")
  .action((opts: { port: string }) => {
    startServer(parseInt(opts.port, 10));
  });
