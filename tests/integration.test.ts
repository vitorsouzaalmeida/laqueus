import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { analyzeProject, functionLogic } from "../src/analyze";
import type { FunctionLogic, GraphSnapshot } from "../src/model";
import { type RunningServer, startServer } from "../src/server";
import { edgePairs, fixture, scan } from "./helpers";

type RawResponse = { status: number; body: string };

const rawRequest = (
  server: RunningServer,
  options: { path: string; method?: string; headers?: Record<string, string> },
): Promise<RawResponse> =>
  new Promise((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: server.address.port,
        path: options.path,
        method: options.method ?? "GET",
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });

describe("CLI server", () => {
  const state: { workspace: string; server?: RunningServer; scans: number } = {
    workspace: "",
    scans: 0,
  };

  beforeEach(async () => {
    state.workspace = await mkdtemp(path.join(tmpdir(), "laqueus-"));
    state.scans = 0;
    const project = path.join(state.workspace, "project");
    const viewer = path.join(state.workspace, "viewer");
    await cp(fixture("topology"), project, { recursive: true });
    await cp(fixture("topology"), path.join(state.workspace, "secret"), { recursive: true });
    await cp(fixture("topology"), viewer, { recursive: true });
    await writeFile(path.join(viewer, "index.html"), "<!doctype html><title>viewer</title>");
    const scanProject = () => {
      state.scans += 1;
      return analyzeProject(project);
    };
    const initial = await scan(project);
    state.server = await startServer({
      host: "127.0.0.1",
      port: 0,
      viewerDir: viewer,
      initial,
      scan: scanProject,
      logic: functionLogic,
    });
  });

  afterEach(async () => {
    await state.server?.close();
    await rm(state.workspace, { recursive: true, force: true });
  });

  it("binds to loopback only and serves the snapshot", async () => {
    const server = state.server as RunningServer;
    expect(server.address.address).toBe("127.0.0.1");
    const response = await fetch(`${server.url}/api/graph`);
    const snapshot = (await response.json()) as GraphSnapshot;
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(snapshot.modules).toHaveLength(4);
    expect(edgePairs(snapshot)).toEqual([
      "src/a.ts -> src/b.ts",
      "src/b.ts -> src/a.ts",
      "src/c.ts -> src/b.ts",
    ]);
  });

  it("serves the viewer but refuses paths outside of it", async () => {
    const server = state.server as RunningServer;
    expect((await rawRequest(server, { path: "/" })).body).toContain("<title>viewer</title>");
    expect((await rawRequest(server, { path: "/%2e%2e/secret/src/a.ts" })).status).toBe(404);
    expect((await rawRequest(server, { path: "/../secret/src/a.ts" })).status).toBe(404);
  });

  it("rejects requests from foreign hosts and origins", async () => {
    const server = state.server as RunningServer;
    const foreignHost = await rawRequest(server, {
      path: "/api/graph",
      headers: { Host: "evil.example:80" },
    });
    const foreignOrigin = await rawRequest(server, {
      path: "/api/rescan",
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });
    expect(foreignHost.status).toBe(403);
    expect(foreignOrigin.status).toBe(403);
    expect(state.scans).toBe(0);
  });

  it("rescans after a file change, reporting parse failures without stopping", async () => {
    const server = state.server as RunningServer;
    const project = path.join(state.workspace, "project");
    await writeFile(path.join(project, "src/lone.ts"), 'import { c } from "./c";\nexport const d = c;\n');
    await writeFile(path.join(project, "src/broken.ts"), "export const = ;\n");

    const response = await fetch(`${server.url}/api/rescan`, { method: "POST" });
    const snapshot = (await response.json()) as GraphSnapshot;

    expect(response.status).toBe(200);
    expect(edgePairs(snapshot)).toContain("src/lone.ts -> src/c.ts");
    expect(snapshot.modules.map((module) => module.path)).toContain("src/broken.ts");
    expect(snapshot.diagnostics).toEqual([
      expect.objectContaining({ file: "src/broken.ts", kind: "parse-error", line: 1 }),
    ]);
    const current = (await (await fetch(`${server.url}/api/graph`)).json()) as GraphSnapshot;
    expect(current.scannedAt).toBe(snapshot.scannedAt);
  });

  it("serves the control flow of one function on demand", async () => {
    const server = state.server as RunningServer;
    const graph = (await (await fetch(`${server.url}/api/graph`)).json()) as GraphSnapshot;
    const target = graph.functions.find((fn) => fn.name === "b" && fn.location.file === "src/b.ts");
    const response = await fetch(`${server.url}/api/logic?fn=${encodeURIComponent(target?.id ?? "")}`);
    const logic = (await response.json()) as FunctionLogic;
    expect(response.status).toBe(200);
    expect(logic.nodes.map((node) => node.kind)).toEqual(["start", "return"]);
    expect(logic.source.lines.join("\n")).toContain("return 1;");
    expect((await fetch(`${server.url}/api/logic?fn=fn:missing:1:0`)).status).toBe(404);
    expect((await fetch(`${server.url}/api/logic`)).status).toBe(400);
  });

  it("collapses concurrent rescan requests into one scan", async () => {
    const server = state.server as RunningServer;
    const responses = await Promise.all(
      [1, 2, 3].map(() => fetch(`${server.url}/api/rescan`, { method: "POST" })),
    );
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);
    expect(state.scans).toBe(1);
  });
});

describe("failed rescans", () => {
  it("keep the previous snapshot", async () => {
    const initial = await scan(fixture("topology"));
    const server = await startServer({
      host: "127.0.0.1",
      port: 0,
      viewerDir: fixture("topology"),
      initial,
      scan: async () => ({ ok: false, error: "disk on fire" }),
    });
    try {
      const response = await fetch(`${server.url}/api/rescan`, { method: "POST" });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "disk on fire" });
      const current = (await (await fetch(`${server.url}/api/graph`)).json()) as GraphSnapshot;
      expect(current.scannedAt).toBe(initial.scannedAt);
    } finally {
      await server.close();
    }
  });
});
