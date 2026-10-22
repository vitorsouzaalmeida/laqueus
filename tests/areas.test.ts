import { describe, expect, it } from "vitest";
import { detectAreas } from "../src/areas";
import type { DependencyEdge } from "../src/model";
import { fixture, scan } from "./helpers";

const edge = (from: string, to: string): DependencyEdge => ({
  kind: "imports",
  from: `module:${from}`,
  to: `module:${to}`,
  occurrences: [],
  names: ["*"],
  via: [],
  typeOnly: false,
});

const cluster = (folder: string) => [1, 2, 3, 4, 5].map((n) => `${folder}/f${n}.ts`);
const dense = (files: readonly string[]) =>
  files.flatMap((from, i) => files.filter((_, j) => j !== i).map((to) => edge(from, to)));

describe("area detection", () => {
  const billing = cluster("src/lib/billing");
  const chat = cluster("src/lib/chat");
  const ids = [...billing, ...chat, "src/lone.ts"].map((path) => `module:${path}`);
  const edges = [...dense(billing), ...dense(chat), edge("src/lib/chat/f1.ts", "src/lib/billing/f1.ts")];
  const detect = (moduleIds: readonly string[]) => detectAreas(moduleIds, edges, "server");

  it("groups files that import each other and names them by folder", () => {
    const areas = detect(ids);
    const top = areas.filter((area) => area.parent === null);

    expect(top.map((area) => area.id)).toEqual([
      "area:server:lib-billing",
      "area:server:lib-chat",
      "area:server:standalone",
    ]);
    expect(top.every((area) => area.side === "server")).toBe(true);
    expect(top.map((area) => [area.label, area.moduleIds.length])).toEqual([
      ["lib/billing", 5],
      ["lib/chat", 5],
      ["Standalone files", 1],
    ]);

    const billingArea = top[0];

    expect(billingArea?.internalImports).toBe(20);
    expect(billingArea?.touchingImports).toBe(21);
  });

  it("sets a file imported from almost everywhere aside before finding areas", () => {
    const db = "src/lib/db.ts";
    const areas = detectAreas(
      [...ids, `module:${db}`],
      [...edges, ...[...billing, ...chat].map((file) => edge(file, db))],
      "server",
    );
    const top = areas.filter((area) => area.parent === null);

    expect(top.map((area) => [area.id, area.label, area.moduleIds])).toEqual([
      ["area:server:lib-billing", "lib/billing", billing.map((file) => `module:${file}`)],
      ["area:server:lib-chat", "lib/chat", chat.map((file) => `module:${file}`)],
      ["area:server:widely-used", "Widely used files", [`module:${db}`]],
      ["area:server:standalone", "Standalone files", ["module:src/lone.ts"]],
    ]);
    expect(areas.filter((area) => area.moduleIds.includes(`module:${db}`)).length).toBe(1);
  });

  it("sets nothing aside when no file stands out", () => {
    expect(detect(ids).some((area) => area.id.endsWith(":widely-used"))).toBe(false);
  });

  it("is deterministic", () => {
    expect(detect(ids.toReversed())).toEqual(detect(ids));
  });

  it("finds areas within each side, so an area never holds files of two sides", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const application = snapshot.modules.filter((module) =>
      ["client", "shared", "server"].includes(module.placement.side),
    );
    const sideOfArea = new Map(snapshot.areas.map((area) => [area.id, area.side]));

    expect(application.every((module) => module.areaId !== null)).toBe(true);
    expect(application.every((module) => sideOfArea.get(module.areaId ?? "") === module.placement.side)).toBe(true);
    expect(snapshot.modules.filter((module) => module.placement.side === "tooling")[0]?.areaId).toBeNull();
  });

  it("gives every file the same total folder weight whatever the folder size", () => {
    const big = cluster("src/big").concat(["src/big/f6.ts", "src/big/f7.ts", "src/big/f8.ts"]);
    const pair = ["src/pair/a.ts", "src/pair/b.ts"];
    const areas = detectAreas(
      [...big, ...pair].map((path) => `module:${path}`),
      [],
      "code",
    );

    expect(areas.filter((area) => area.parent === null).map((area) => area.moduleIds.length)).toEqual([8, 2]);
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
    expect(snapshot.modules.find((module) => module.path === "src/main.ts")?.externals).toEqual(["external-package"]);
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
