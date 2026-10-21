import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { type AnalysisCache, functionLogic } from "../analyze";
import { type Result, err, errorMessage, ok } from "../model";
import { type ServerOptions, startServer } from "../server";
import { parse, scan } from "./common";

export type ServeOptions = { root: string; open: boolean; port: number; help: boolean };

const defaultPort = 4747;

export const serveUsage = `Usage: laqueus [serve] [path] [--no-open] [--port ${defaultPort}]

  Scans the project and opens the viewer.

  path        defaults to the current working directory
  --no-open   start the server without opening a browser
  --port <n>  port to listen on (default ${defaultPort}); 0 asks the OS for a free port
  --help      show this message`;

export const parseServeArgs = (argv: readonly string[], cwd: string): Result<ServeOptions> => {
  const parsed = parse(argv, {
    "no-open": { type: "boolean", default: false },
    port: { type: "string", default: String(defaultPort) },
    help: { type: "boolean", short: "h", default: false },
  });

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

export const serve = async (
  argv: readonly string[],
  cwd: string,
  viewerDir: string,
  viewerMiddleware?: ServerOptions["viewerMiddleware"],
): Promise<number> => {
  const options = parseServeArgs(argv, cwd);

  if (!options.ok) {
    console.error(`${options.error}\n\n${serveUsage}`);
    return 1;
  }

  if (options.value.help) {
    console.log(serveUsage);
    return 0;
  }

  if (!viewerMiddleware && !existsSync(path.join(viewerDir, "index.html"))) {
    console.error(`Viewer assets not found in ${viewerDir}. Run "pnpm build" first.`);
    return 1;
  }

  const cache: AnalysisCache = new Map();
  const initial = await scan(options.value.root, (line) => console.log(line), cache);

  if (!initial.ok) {
    console.error(initial.error);
    return 1;
  }

  const server = await startServer({
    host: "127.0.0.1",
    port: options.value.port,
    viewerDir,
    initial: initial.value,
    scan: () => scan(options.value.root, () => {}, cache),
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
