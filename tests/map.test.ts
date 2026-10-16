import { describe, expect, it } from "vitest";
import { layered } from "../viewer/layered";
import { buildRouteView, buildTree, buildView, shortestPath } from "../viewer/map";
import { fixture, scan } from "./helpers";

const box = (id: string, rank?: "top" | "bottom") => ({ id, width: 100, height: 40, rank });
const options = { maxPerRow: 3, gapX: 10, gapY: 20 };

describe("layered layout", () => {
  it("places importers above what they import", () => {
    const positions = layered([box("a"), box("b"), box("c")], [{ from: "a", to: "b" }, { from: "b", to: "c" }], options);
    const y = (id: string) => positions.get(id)?.y ?? Number.NaN;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
  });

  it("breaks cycles along the weaker direction and pins ranked nodes", () => {
    const positions = layered(
      [box("in", "top"), box("a"), box("b"), box("out", "bottom")],
      [
        { from: "a", to: "b", count: 3 },
        { from: "b", to: "a", count: 1 },
        { from: "in", to: "a" },
        { from: "b", to: "out" },
      ],
      options,
    );
    const y = (id: string) => positions.get(id)?.y ?? Number.NaN;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("in")).toBeLessThan(y("a"));
    expect(y("out")).toBeGreaterThan(y("b"));
  });

  it("wraps wide layers into rows", () => {
    const positions = layered(["a", "b", "c", "d", "e"].map((id) => box(id)), [], options);
    expect(new Set([...positions.values()].map((point) => point.y)).size).toBe(2);
  });
});

describe("drill-down map", () => {
  it("starts with one card per side and keeps tests in the tray", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const hidden = buildTree(snapshot, { grouping: "areas", tray: new Set() });
    expect(hidden.nodes.get("root")?.children).toEqual(["side:client", "side:shared", "side:server"]);
    const shown = buildTree(snapshot, { grouping: "areas", tray: new Set(["test"]) });
    expect(shown.nodes.get("root")?.children).toContain("side:test");
  });

  it("aggregates imports between sides on the first level", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const tree = buildTree(snapshot, { grouping: "areas", tray: new Set() });
    const view = buildView(snapshot, tree, "root");
    expect(view.mode).toBe("cards");
    expect(view.items.map((item) => item.id)).toEqual(["side:client", "side:shared", "side:server"]);
    expect(view.links.map((link) => `${link.from} -> ${link.to} (${link.count})`).sort()).toEqual([
      "side:client -> side:shared (2)",
      "side:server -> side:shared (1)",
    ]);
  });

  it("shows files with stubs for what lies outside the opened group", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const tree = buildTree(snapshot, { grouping: "folders", tray: new Set() });
    const view = buildView(snapshot, tree, "side:server");
    expect(view.mode).toBe("files");
    expect(view.items.filter((item) => item.kind === "stub").map((item) => item.label)).toEqual(["Shared"]);
    expect(view.links.find((link) => link.to === "stub:side:shared")).toMatchObject({
      from: "module:src/routes/+page.server.ts",
      count: 1,
    });
  });

  it("shows a route's client and server dependencies side by side", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const tree = buildTree(snapshot, { grouping: "folders", tray: new Set() });
    const route = snapshot.routes.find((candidate) => candidate.url === "/");
    if (!route) throw new Error("missing route");
    const view = buildRouteView(snapshot, tree, route);
    expect(view.items.filter((item) => item.column === 0 && item.kind === "file").map((item) => item.label).sort()).toEqual([
      "+layout.svelte",
      "+page.svelte",
      "Nav.svelte",
      "format.ts",
    ]);
    expect(view.items.filter((item) => item.column === 1).map((item) => item.label).sort()).toEqual([
      "+page.server.ts",
      "db.ts",
      "format.ts",
    ]);
    expect(view.items.find((item) => item.column === 0 && item.kind === "group")?.moduleIds).toEqual([
      "module:src/lib/client-only.ts",
    ]);
  });

  it("finds the shortest import path between two files", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    expect(shortestPath(snapshot, "module:src/routes/+layout.svelte", "module:src/lib/client-only.ts")).toEqual([
      "module:src/routes/+layout.svelte",
      "module:src/lib/components/Nav.svelte",
      "module:src/lib/client-only.ts",
    ]);
    expect(shortestPath(snapshot, "module:src/lib/format.ts", "module:src/routes/+page.svelte")).toBeNull();
  });
});
