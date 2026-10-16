import { describe, expect, it } from "vitest";
import { edgePairs, fixture, scan } from "./helpers";

const metricsOf = (snapshot: Awaited<ReturnType<typeof scan>>, path: string) =>
  snapshot.modules.find((module) => module.path === path)?.metrics;

describe("module dependency topology", () => {
  it("builds nodes, edges, cycles and fan-in/fan-out", async () => {
    const snapshot = await scan(fixture("topology"));

    expect(snapshot.modules.map((module) => module.path)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/lone.ts",
    ]);
    expect(edgePairs(snapshot)).toEqual([
      "src/a.ts -> src/b.ts",
      "src/b.ts -> src/a.ts",
      "src/c.ts -> src/b.ts",
    ]);
    expect(metricsOf(snapshot, "src/a.ts")).toMatchObject({ fanIn: 1, fanOut: 1, cycleGroup: 0 });
    expect(metricsOf(snapshot, "src/b.ts")).toMatchObject({ fanIn: 2, fanOut: 1, cycleGroup: 0 });
    expect(metricsOf(snapshot, "src/c.ts")).toMatchObject({ fanIn: 0, fanOut: 1, cycleGroup: null });
    expect(metricsOf(snapshot, "src/lone.ts")).toMatchObject({
      fanIn: 0,
      fanOut: 0,
      cycleGroup: null,
    });
    expect(metricsOf(snapshot, "src/lone.ts")?.island).not.toBe(
      metricsOf(snapshot, "src/a.ts")?.island,
    );
    expect(snapshot.diagnostics).toEqual([]);
  });

  it("never links functions across files", async () => {
    const snapshot = await scan(fixture("topology"));
    const name = (id: string) => snapshot.functions.find((fn) => fn.id === id)?.name;
    expect(snapshot.callEdges.map((edge) => `${name(edge.from)} -> ${name(edge.to)}`)).toEqual([]);
  });
});

describe("import extraction and resolution", () => {
  it("keeps runtime imports and drops type-only, asset and external ones", async () => {
    const snapshot = await scan(fixture("imports"));
    const fromMain = edgePairs(snapshot).filter((pair) => pair.startsWith("src/main.ts"));

    expect(fromMain).toEqual([
      "src/main.ts -> src/Button.svelte",
      "src/main.ts -> src/aliased.ts",
      "src/main.ts -> src/helper.ts",
      "src/main.ts -> src/lazy.ts",
      "src/main.ts -> src/legacy.js",
      "src/main.ts -> src/named-reexport.ts",
      "src/main.ts -> src/reexported.ts",
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

  it("extracts functions from both Svelte script blocks", async () => {
    const snapshot = await scan(fixture("sveltekit"));
    const widget = snapshot.functions
      .filter((fn) => fn.moduleId === "module:src/lib/Widget.svelte")
      .map((fn) => ({ name: fn.name, line: fn.location.line, complexity: fn.complexity }));
    expect(widget).toEqual([
      { name: "label", line: 2, complexity: 2 },
      { name: "click", line: 8, complexity: 1 },
    ]);
  });
});
