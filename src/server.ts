import { readFile } from "node:fs/promises";
import { type IncomingMessage, type Server, type ServerResponse, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { type FunctionLogic, type GraphSnapshot, type Result, err, errorMessage } from "./model";

export type ServerOptions = {
  host: string;
  port: number;
  viewerDir: string;
  initial: GraphSnapshot;
  scan: () => Promise<Result<GraphSnapshot>>;
  logic?: (snapshot: GraphSnapshot, functionId: string) => Promise<Result<FunctionLogic>>;
  viewerMiddleware?: (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
};

export type RunningServer = {
  url: string;
  address: AddressInfo;
  close: () => Promise<void>;
};

const contentTypes: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
};

const send = (response: ServerResponse, status: number, body: string | Buffer, type = "text/plain; charset=utf-8") => {
  response.writeHead(status, { ...securityHeaders, "Content-Type": type });
  response.end(body);
};

const sendJson = (response: ServerResponse, status: number, value: unknown) =>
  send(response, status, JSON.stringify(value), "application/json; charset=utf-8");

const allowedHosts = (address: AddressInfo) =>
  new Set([`127.0.0.1:${address.port}`, `localhost:${address.port}`, `[::1]:${address.port}`]);

const isTrustedRequest = (request: IncomingMessage, address: AddressInfo) => {
  const hosts = allowedHosts(address);
  const origin = request.headers.origin;
  const originHost = origin === undefined ? undefined : URL.canParse(origin) && new URL(origin).host;

  return (
    hosts.has(request.headers.host ?? "") &&
    (origin === undefined || (typeof originHost === "string" && hosts.has(originHost)))
  );
};

const safeDecode = (value: string): string | undefined => {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
};

const staticPath = (viewerDir: string, pathname: string): string | undefined => {
  const decoded = safeDecode(pathname);

  if (decoded === undefined || decoded.includes("\0")) return undefined;

  const target = path.resolve(viewerDir, `.${decoded === "/" ? "/index.html" : decoded}`);

  return target.startsWith(`${viewerDir}${path.sep}`) ? target : undefined;
};

const serveStatic = async (viewerDir: string, pathname: string, response: ServerResponse) => {
  const target = staticPath(viewerDir, pathname);
  const content = target ? await readFile(target).catch(() => undefined) : undefined;

  return target && content
    ? send(response, 200, content, contentTypes[path.extname(target)] ?? "application/octet-stream")
    : send(response, 404, "Not found");
};

export const startServer = async (options: ServerOptions): Promise<RunningServer> => {
  const viewerDir = path.resolve(options.viewerDir);
  const state: { snapshot: GraphSnapshot; scanning: Promise<Result<GraphSnapshot>> | null } = {
    snapshot: options.initial,
    scanning: null,
  };

  const rescan = (): Promise<Result<GraphSnapshot>> => {
    if (state.scanning) return state.scanning;

    const scanning = options
      .scan()
      .catch((error: unknown) => err(errorMessage(error)))
      .then((result) => {
        if (result.ok) state.snapshot = result.value;
        state.scanning = null;

        return result;
      });

    state.scanning = scanning;

    return scanning;
  };

  const handle = async (request: IncomingMessage, response: ServerResponse, address: AddressInfo) => {
    if (!isTrustedRequest(request, address)) return send(response, 403, "Forbidden");

    const url = new URL(request.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    if (pathname === "/api/graph") {
      return request.method === "GET"
        ? sendJson(response, 200, state.snapshot)
        : send(response, 405, "Method not allowed");
    }

    if (pathname === "/api/rescan") {
      if (request.method !== "POST") return send(response, 405, "Method not allowed");

      const result = await rescan();

      return result.ok ? sendJson(response, 200, result.value) : sendJson(response, 500, { error: result.error });
    }

    if (pathname === "/api/logic") {
      const functionId = url.searchParams.get("fn");

      if (request.method !== "GET") return send(response, 405, "Method not allowed");
      if (!functionId || !options.logic) return sendJson(response, 400, { error: "Missing function id" });

      const result = await options.logic(state.snapshot, functionId);

      return result.ok ? sendJson(response, 200, result.value) : sendJson(response, 404, { error: result.error });
    }

    if (pathname.startsWith("/api/")) return send(response, 404, "Not found");

    if (request.method !== "GET" && request.method !== "HEAD") {
      return send(response, 405, "Method not allowed");
    }

    return options.viewerMiddleware
      ? options.viewerMiddleware(request, response, () => send(response, 404, "Not found"))
      : serveStatic(viewerDir, pathname, response);
  };

  const server: Server = createServer((request, response) => {
    handle(request, response, server.address() as AddressInfo).catch(() => {
      if (!response.headersSent) send(response, 500, "Internal error");
      else response.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  const hostForUrl = address.family === "IPv6" ? `[${address.address}]` : address.address;

  return {
    url: `http://${hostForUrl}:${address.port}`,
    address,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
