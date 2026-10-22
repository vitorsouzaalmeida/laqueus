import { describe, expect, it } from "vitest";
import type { GraphSnapshot, Side } from "../src/model";
import { groupDirectories } from "../src/structure";
import { fixture, scan } from "./helpers";

const sides = (snapshot: GraphSnapshot) =>
  snapshot.modules.reduce<Partial<Record<Side, string[]>>>(
    (map, module) => ({
      ...map,
      [module.placement.side]: [...(map[module.placement.side] ?? []), module.path],
    }),
    {},
  );

const placementOf = (snapshot: GraphSnapshot, path: string) =>
  snapshot.modules.find((module) => module.path === path)?.placement;

describe("SvelteKit structure", () => {
  it("places files by SvelteKit entry points and import reachability", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));

    expect(snapshot.framework).toBe("sveltekit");
    expect(sides(snapshot)).toEqual({
      client: [
        "src/hooks.client.ts",
        "src/lib/client-only.ts",
        "src/lib/components/Nav.svelte",
        "src/routes/+layout.svelte",
        "src/routes/+page.svelte",
        "src/routes/about/+page.ts",
      ],
      shared: ["src/lib/format.ts"],
      server: [
        "src/hooks.server.ts",
        "src/lib/server/db.ts",
        "src/lib/server/unused.ts",
        "src/routes/+page.server.ts",
        "src/routes/api/+server.ts",
      ],
      unreached: ["src/lib/orphan.ts"],
      tooling: ["scripts/seed.ts", "svelte.config.js"],
    });
    expect(snapshot.lanes.map((lane) => lane.side)).toEqual(["client", "shared", "server", "unreached", "tooling"]);
  });

  it("marks framework entry points and explains reachability with an import chain", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));

    expect(placementOf(snapshot, "src/routes/api/+server.ts")?.entry).toBe("SvelteKit API endpoint");
    expect(placementOf(snapshot, "src/lib/format.ts")).toMatchObject({
      entry: null,
      chains: {
        client: ["module:src/routes/+page.svelte", "module:src/lib/format.ts"],
        server: ["module:src/routes/+page.server.ts", "module:src/lib/format.ts"],
      },
    });
    expect(placementOf(snapshot, "src/lib/client-only.ts")?.chains).toEqual({
      client: [
        "module:src/routes/+layout.svelte",
        "module:src/lib/components/Nav.svelte",
        "module:src/lib/client-only.ts",
      ],
      server: undefined,
    });
  });

  it("lays lanes out left to right and gives every file its own position", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const xOf = (side: Side) =>
      Math.max(
        ...snapshot.modules.filter((module) => module.placement.side === side).map((module) => module.position.x),
      );
    const minXOf = (side: Side) =>
      Math.min(
        ...snapshot.modules.filter((module) => module.placement.side === side).map((module) => module.position.x),
      );

    expect(xOf("client")).toBeLessThan(minXOf("shared"));
    expect(xOf("shared")).toBeLessThan(minXOf("server"));

    const positions = new Set(snapshot.modules.map((module) => `${module.position.x},${module.position.y}`));

    expect(positions.size).toBe(snapshot.modules.length);
  });

  it("aggregates file imports into folder edges", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const groupOf = new Map(snapshot.modules.map((module) => [module.id, module.groupId]));
    const crossGroup = snapshot.dependencyEdges.filter(
      (edge) => groupOf.get(edge.from) !== groupOf.get(edge.to),
    ).length;

    expect(snapshot.groupEdges.reduce((sum, edge) => sum + edge.count, 0)).toBe(crossGroup);
    expect(snapshot.groups.every((group) => group.moduleIds.length > 0)).toBe(true);
  });

  it("treats projects without SvelteKit as plain code", async () => {
    const snapshot = await scan(fixture("topology"));

    expect(snapshot.framework).toBeNull();
    expect(new Set(snapshot.modules.map((module) => module.placement.side))).toEqual(new Set(["code"]));
    expect(placementOf(snapshot, "src/c.ts")?.entry).toBe("Root file: no other file imports it");
    expect(placementOf(snapshot, "src/b.ts")?.entry).toBeNull();
  });
});

describe("folder grouping", () => {
  it("merges small folders into their parent", () => {
    const assignment = groupDirectories([
      "a/b/one.ts",
      "a/b/two.ts",
      "a/three.ts",
      "a/c/d/1.ts",
      "a/c/d/2.ts",
      "a/c/d/3.ts",
      "a/c/d/4.ts",
    ]);
    expect(Object.fromEntries(assignment)).toEqual({
      "a/b/one.ts": ".",
      "a/b/two.ts": ".",
      "a/three.ts": ".",
      "a/c/d/1.ts": "a/c/d",
      "a/c/d/2.ts": "a/c/d",
      "a/c/d/3.ts": "a/c/d",
      "a/c/d/4.ts": "a/c/d",
    });
  });
});
