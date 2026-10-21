#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Io, exportUsage, runExport } from "./commands/export";
import { listUsage, runList } from "./commands/list";
import { serve, serveUsage } from "./commands/serve";
import { errorMessage } from "./model";
import type { ServerOptions } from "./server";

const usage = [serveUsage, listUsage, exportUsage].join("\n\n");

const viewerDirectory = () => path.join(path.dirname(fileURLToPath(import.meta.url)), "viewer");

const processIo = (cwd: string): Io => ({
  cwd,
  out: (text) => process.stdout.write(text),
  log: (line) => console.error(line),
  now: () => new Date(),
});

export const main = async (
  argv: readonly string[],
  cwd: string,
  viewerMiddleware?: ServerOptions["viewerMiddleware"],
  io: Io = processIo(cwd),
): Promise<number> => {
  const [command, ...rest] = argv;

  switch (command) {
    case "list":
      return runList(rest, io);
    case "export":
      return runExport(rest, io);
    case "serve":
      return serve(rest, cwd, viewerDirectory(), viewerMiddleware);
    case "--help":
    case "-h":
      console.log(usage);
      return 0;
    default:
      return serve(argv, cwd, viewerDirectory(), viewerMiddleware);
  }
};

const isEntryPoint = () => {
  const entry = process.argv[1];
  return (
    entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
};

if (isEntryPoint()) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => process.stdout.write("", () => process.exit(code)),
    (error: unknown) => {
      console.error(errorMessage(error));
      process.exit(1);
    },
  );
}
