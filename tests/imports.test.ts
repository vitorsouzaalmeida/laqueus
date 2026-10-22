import { describe, expect, it } from "vitest";
import { createFacts } from "../src/facts";
import { edgePairs, fixture, scan } from "./helpers";

const metricsOf = (snapshot: Awaited<ReturnType<typeof scan>>, path: string) =>
  snapshot.modules.find((module) => module.path === path)?.metrics;

describe("module dependency topology", () => {
  it("builds nodes, edges, cycles and fan-in/fan-out", async () => {
    const snapshot = await scan(fixture("topology"));

    expect(snapshot.modules.map((module) => module.path)).toEqual(["src/a.ts", "src/b.ts", "src/c.ts", "src/lone.ts"]);
    expect(edgePairs(snapshot)).toEqual(["src/a.ts -> src/b.ts", "src/b.ts -> src/a.ts", "src/c.ts -> src/b.ts"]);
    expect(metricsOf(snapshot, "src/a.ts")).toMatchObject({ fanIn: 1, fanOut: 1, cycleGroup: 0 });
    expect(metricsOf(snapshot, "src/b.ts")).toMatchObject({ fanIn: 2, fanOut: 1, cycleGroup: 0 });
    expect(metricsOf(snapshot, "src/c.ts")).toMatchObject({ fanIn: 0, fanOut: 1, cycleGroup: null });
    expect(metricsOf(snapshot, "src/lone.ts")).toMatchObject({
      fanIn: 0,
      fanOut: 0,
      cycleGroup: null,
    });
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("never links functions across files", async () => {
    const snapshot = await scan(fixture("topology"));
    const name = (id: string) => snapshot.functions.find((fn) => fn.id === id)?.name;

    expect(snapshot.callEdges.map((edge) => `${name(edge.from)} -> ${name(edge.to)}`)).toEqual([]);
  });
});

describe("import extraction and resolution", () => {
  it("keeps local imports, flags type-only ones, and drops asset and external ones", async () => {
    const snapshot = await scan(fixture("imports"));
    const fromMain = snapshot.dependencyEdges
      .filter((edge) => edge.from === "module:src/main.ts")
      .map((edge) => `${edge.to.replace("module:", "")}${edge.typeOnly ? " (types)" : ""}`)
      .toSorted();

    expect(fromMain).toEqual([
      "src/Button.svelte",
      "src/aliased.ts",
      "src/helper.ts",
      "src/lazy.ts",
      "src/legacy.js",
      "src/named-reexport.ts",
      "src/reexported.ts",
      "src/type-reexport.ts (types)",
      "src/types-two.ts (types)",
      "src/types.ts (types)",
    ]);
  });

  it("records each occurrence behind a single edge", async () => {
    const snapshot = await scan(fixture("imports"));
    const helperEdge = snapshot.dependencyEdges.find(
      (edge) => edge.from === "module:src/main.ts" && edge.to === "module:src/helper.ts",
    );

    expect(helperEdge?.occurrences.map((location) => location.line)).toEqual([3, 4]);
  });

  it("reports only genuinely unresolved local imports", async () => {
    const snapshot = await scan(fixture("imports"));
    expect(snapshot.diagnostics).toEqual([
      {
        file: "src/main.ts",
        line: 9,
        kind: "unresolved-import",
        message: 'Cannot resolve "./does-not-exist" to a source file',
      },
    ]);
  });
});

describe("SvelteKit projects", () => {
  it("resolves #lib imports and never links routes by convention", async () => {
    const snapshot = await scan(fixture("sveltekit"));

    expect(edgePairs(snapshot)).toEqual([
      "src/lib/Widget.svelte -> src/lib/orders.ts",
      "src/lib/orders.ts -> src/lib/util.ts",
      "src/routes/+page.server.ts -> src/lib/orders.ts",
      "src/routes/+page.svelte -> src/lib/Widget.svelte",
    ]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("resolves legacy $lib imports without a generated tsconfig", async () => {
    const snapshot = await scan(fixture("sveltekit-legacy"));

    expect(edgePairs(snapshot)).toEqual([
      "src/lib/Widget.svelte -> src/lib/counter.svelte.ts",
      "src/lib/Widget.svelte -> src/lib/util.ts",
      "src/routes/+page.svelte -> src/lib/Widget.svelte",
      "src/routes/+page.ts -> src/lib/util.ts",
    ]);
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("extracts functions from both Svelte script blocks and the markup", async () => {
    const snapshot = await scan(fixture("sveltekit"));
    const widget = snapshot.functions
      .filter((fn) => fn.moduleId === "module:src/lib/Widget.svelte")
      .map((fn) => ({ name: fn.name, line: fn.location.line, complexity: fn.complexity }));

    expect(widget).toEqual([
      { name: "label", line: 2, complexity: 1 },
      { name: "click", line: 8, complexity: 1 },
      { name: "<template>", line: 13, complexity: 1 },
    ]);
  });
});

const edgesFrom = (snapshot: Awaited<ReturnType<typeof scan>>, from: string) =>
  snapshot.dependencyEdges
    .filter((edge) => edge.from === `module:${from}`)
    .map((edge) => ({
      to: edge.to.replace("module:", ""),
      names: edge.names,
      via: edge.via.map((id) => id.replace("module:", "")),
      typeOnly: edge.typeOnly,
    }))
    .toSorted((a, b) => a.to.localeCompare(b.to));

describe("re-exports and type imports", () => {
  it("follows a re-export through a file that has code of its own", async () => {
    const snapshot = await scan(fixture("reexports"));

    expect(edgesFrom(snapshot, "src/page.ts")).toEqual([
      { to: "src/helpers.ts", names: ["logger"], via: [], typeOnly: false },
      { to: "src/ui.ts", names: ["cx"], via: ["src/helpers.ts"], typeOnly: false },
    ]);
    expect(snapshot.modules.find((module) => module.path === "src/helpers.ts")?.barrel).toBe(false);
  });

  it("follows type imports through re-exports and counts inline import types", async () => {
    const snapshot = await scan(fixture("reexports"));

    expect(edgesFrom(snapshot, "src/use.ts")).toEqual([
      { to: "src/shapes.ts", names: ["make"], via: [], typeOnly: false },
      { to: "src/types.ts", names: ["Shape"], via: ["src/shapes.ts"], typeOnly: true },
    ]);
  });

  it("finds cycles made only of type imports, and does not take a file imported for its types as a root", async () => {
    const snapshot = await scan(fixture("reexports"));
    const cycle = snapshot.modules.filter((module) => module.metrics.cycleGroup !== null).map((module) => module.path);

    expect(cycle).toEqual(["src/ta.ts", "src/tb.ts"]);
    expect(createFacts(snapshot, null).cycles[0]).toMatchObject({ withoutTypes: 0 });
    expect(snapshot.modules.find((module) => module.path === "src/types.ts")?.placement.entry).toBeNull();
  });

  it("warns about a file that imports itself instead of calling it a cycle", async () => {
    const snapshot = await scan(fixture("reexports"));

    expect(snapshot.modules.find((module) => module.path === "src/self.ts")?.metrics.cycleGroup).toBeNull();
    expect(snapshot.diagnostics).toEqual([
      { file: "src/self.ts", line: 1, kind: "self-import", message: "This file imports itself." },
    ]);
  });
});
