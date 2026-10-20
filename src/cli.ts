#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { type AnalysisCache, analyzeProject, functionLogic } from "./analyze";
import { type GraphSnapshot, type Result, err, errorMessage, ok } from "./model";
import { type ServerOptions, startServer } from "./server";

export type CliOptions = { root: string; open: boolean; port: number; help: boolean };

const defaultPort = 4747;

const usage = `Usage: laqueus [path] [--no-open] [--port ${defaultPort}]

  path        defaults to the current working directory
  --no-open   start the server without opening a browser
  --port <n>  port to listen on (default ${defaultPort}); 0 asks the OS for a free port
  --help      show this message`;

export const parseCliArgs = (argv: readonly string[], cwd: string): Result<CliOptions> => {
  const parsed = (() => {
    try {
      return ok(
        parseArgs({
          args: [...argv],
          allowPositionals: true,
          options: {
            "no-open": { type: "boolean", default: false },
            port: { type: "string", default: String(defaultPort) },
            help: { type: "boolean", short: "h", default: false },
          },
        }),
      );
    } catch (error) {
      return err(errorMessage(error));
    }
  })();

  if (!parsed.ok) return parsed;

  const { values, positionals } = parsed.value;

  if (positionals.length > 1) return err("Expected at most one path argument");

  const port = Number(values.port);

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    return err(`Invalid port: ${values.port}`);
  }

  return ok({
    root: path.resolve(cwd, positionals[0] ?? "."),
    open: !values["no-open"],
    port,
    help: values.help,
  });
};

const summary = (snapshot: GraphSnapshot) => {
  const cycles = new Set(
    snapshot.modules.flatMap((module) => (module.metrics.cycleGroup === null ? [] : [module.metrics.cycleGroup])),
  ).size;
  return [
    `${snapshot.modules.length} files`,
    `${snapshot.dependencyEdges.length} import edges`,
    `${cycles} cycles`,
    `${snapshot.functions.length} functions`,
    `${snapshot.callEdges.length} local call edges`,
    `${snapshot.diagnostics.length} warnings`,
  ].join(", ");
};

const openBrowser = (url: string) => {
  const [command, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", '""', url]]
        : ["xdg-open", [url]];

  const child = spawn(command, args, { stdio: "ignore", detached: true });
  child.on("error", () => console.log(`Could not open a browser. Visit ${url}`));
  child.unref();
};

const viewerDirectory = () => path.join(path.dirname(fileURLToPath(import.meta.url)), "viewer");

export const main = async (
  argv: readonly string[],
  cwd: string,
  viewerMiddleware?: ServerOptions["viewerMiddleware"],
): Promise<number> => {
  const options = parseCliArgs(argv, cwd);

  if (!options.ok) {
    console.error(`${options.error}\n\n${usage}`);
    return 1;
  }

  if (options.value.help) {
    console.log(usage);
    return 0;
  }

  const viewerDir = viewerDirectory();

  if (!viewerMiddleware && !existsSync(path.join(viewerDir, "index.html"))) {
    console.error(`Viewer assets not found in ${viewerDir}. Run "pnpm build" first.`);
    return 1;
  }

  console.log(`Scanning ${options.value.root} ...`);
  const cache: AnalysisCache = new Map();
  const scan = () => analyzeProject(options.value.root, cache);
  const initial = await scan();

  if (!initial.ok) {
    console.error(initial.error);
    return 1;
  }

  console.log(`Scanned in ${initial.value.durationMs} ms: ${summary(initial.value)}`);

  const server = await startServer({
    host: "127.0.0.1",
    port: options.value.port,
    viewerDir,
    initial: initial.value,
    scan,
    logic: functionLogic,
    viewerMiddleware,
  }).then(
    (running) => ok(running),
    (error: unknown) => err(errorMessage(error)),
  );

  if (!server.ok) {
    console.error(
      server.error.includes("EADDRINUSE")
        ? `Port ${options.value.port} is already in use. Stop the other process or pass --port <n>.`
        : `Could not start the server: ${server.error}`,
    );
    return 1;
  }

  console.log(`Laqueus running at ${server.value.url}`);
  console.log("Press Ctrl+C to stop.");
  if (options.value.open) openBrowser(server.value.url);

  return new Promise<number>((resolve) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      process.once("SIGINT", () => process.exit(130));
      void server.value.close().then(() => resolve(0));
    };

    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  });
};

const isEntryPoint = () => {
  const entry = process.argv[1];
  return (
    entry !== undefined && existsSync(entry) && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  );
};

if (isEntryPoint()) {
  main(process.argv.slice(2), process.cwd()).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(errorMessage(error));
      process.exit(1);
    },
  );
}
