#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type Io, exportUsage, runExport } from "./commands/export";
import { listUsage, runList } from "./commands/list";
import { errorMessage } from "./model";

const usage = [listUsage, exportUsage].join("\n\n");

const processIo = (cwd: string): Io => ({
  cwd,
  out: (text) => process.stdout.write(text),
  log: (line) => console.error(line),
  now: () => new Date(),
});

export const main = async (argv: readonly string[], cwd: string, io: Io = processIo(cwd)): Promise<number> => {
  const [command, ...rest] = argv;

  switch (command) {
    case "list":
      return runList(rest, io);
    case "export":
      return runExport(rest, io);
    case undefined:
    case "--help":
    case "-h":
      io.out(`${usage}\n`);
      return 0;
    default:
      io.log(`Unknown command: ${command}\n\n${usage}`);
      return 1;
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
