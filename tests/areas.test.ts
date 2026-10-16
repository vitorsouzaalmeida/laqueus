import { describe, expect, it } from "vitest";
import { detectAreas } from "../src/areas";
import type { DependencyEdge } from "../src/model";
import { fixture, scan } from "./helpers";

const edge = (from: string, to: string): DependencyEdge => ({
  kind: "imports",
  from: `module:${from}`,
  to: `module:${to}`,
  occurrences: [],
});

const cluster = (folder: string) => [1, 2, 3, 4, 5].map((n) => `${folder}/f${n}.ts`);
const dense = (files: readonly string[]) =>
  files.flatMap((from, i) => files.filter((_, j) => j !== i).map((to) => edge(from, to)));

describe("area detection", () => {
  const billing = cluster("src/lib/billing");
  const chat = cluster("src/lib/chat");
  const ids = [...billing, ...chat, "src/lone.ts"].map((path) => `module:${path}`);
  const edges = [...dense(billing), ...dense(chat), edge("src/lib/chat/f1.ts", "src/lib/billing/f1.ts")];

  it("groups files that import each other and names them by folder", () => {
    const areas = detectAreas(ids, edges);
    const top = areas.filter((area) => area.parent === null);
    expect(top.map((area) => [area.label, area.moduleIds.length])).toEqual([
      ["lib/billing", 5],
      ["lib/chat", 5],
      ["Standalone files", 1],
    ]);
    const billingArea = top[0];
    expect(billingArea?.internalImports).toBe(20);
    expect(billingArea?.touchingImports).toBe(21);
  });

  it("is deterministic", () => {
    expect(detectAreas([...ids].reverse(), edges)).toEqual(detectAreas(ids, edges));
  });

  it("assigns every scanned application file to an area", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const application = snapshot.modules.filter((module) =>
      ["client", "shared", "server"].includes(module.placement.side),
    );
    expect(application.every((module) => module.areaId !== null)).toBe(true);
    expect(snapshot.modules.filter((module) => module.placement.side === "test")[0]?.areaId).toBeNull();
  });
});

describe("SvelteKit routes", () => {
  it("lists routes with URLs, roles and wrapping layouts", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    expect(
      snapshot.routes.map((route) => ({
        url: route.url,
        roles: route.files.map((file) => file.role),
        layouts: route.layouts,
      })),
    ).toEqual([
      { url: "/", roles: ["layout", "page", "server-load"], layouts: [] },
      { url: "/about", roles: ["universal-load"], layouts: ["module:src/routes/+layout.svelte"] },
      { url: "/api", roles: ["endpoint"], layouts: ["module:src/routes/+layout.svelte"] },
    ]);
  });
});

describe("external packages", () => {
  it("records bare package imports per file", async () => {
    const snapshot = await scan(fixture("imports"));
    expect(snapshot.modules.find((module) => module.path === "src/main.ts")?.externals).toEqual([
      "external-package",
    ]);
  });
});

describe("SvelteKit server-only boundary", () => {
  it("warns when client-side code imports a server-only module", async () => {
    const snapshot = await scan(fixture("sveltekit-boundary"));
    expect(snapshot.diagnostics).toEqual([
      {
        file: "src/routes/+page.svelte",
        line: 2,
        kind: "server-only-import",
        message:
          "Client-side code imports the server-only module src/lib/server/secret.ts. SvelteKit refuses to build this.",
      },
    ]);
  });
});
