import { describe, expect, it } from "vitest";
import { analyzeCode, fixture, scan } from "./helpers";
import { createFacts } from "../src/facts";
import { smallestCuts } from "../src/metrics";
import type { DependencyEdge } from "../src/model";

const edge = (from: string, to: string): DependencyEdge => ({
  kind: "imports",
  from,
  to,
  occurrences: [],
  names: ["*"],
  via: [],
});

describe("function names", () => {
  const names = analyzeCode(
    "names.ts",
    `export const load = async () => {
  await db.transaction(async (tx) => {
    items.map((item) => item.id);
  });
  return new Promise((resolve) => resolve(1));
};
fetchAll().then((rows) => rows);
function build() {
  return () => 1;
}
`,
  ).functions.map((fn) => fn.name);

  it("names a callback after the function holding it and the call it is passed to", () => {
    expect(names).toEqual([
      "load",
      "load › db.transaction callback",
      "load › db.transaction callback › items.map callback",
      "load › new Promise callback",
      "then callback",
      "build",
      "build › <anonymous>@9",
    ]);
  });
});

describe("smallest cycle cuts", () => {
  it("finds the fewest imports whose removal breaks every loop", () => {
    const edges = [edge("a", "b"), edge("b", "c"), edge("c", "a"), edge("b", "a")];
    expect(smallestCuts(["a", "b", "c"], edges)).toEqual([[edges[0]]]);
  });

  it("lists every choice of the same size", () => {
    const edges = [edge("a", "b"), edge("b", "a")];
    expect(smallestCuts(["a", "b"], edges)).toHaveLength(2);
  });

  it("cuts a file that imports itself", () => {
    const self = edge("a", "a");
    expect(smallestCuts(["a"], [self])).toEqual([[self]]);
  });

  it("attaches the cuts and the imported names to each cycle", async () => {
    const facts = createFacts(await scan(fixture("topology")), null);

    expect(facts.cycles[0]?.cuts).toEqual([
      [{ from: "src/a.ts", to: "src/b.ts", lines: [1], names: ["b"], via: [] }],
      [{ from: "src/b.ts", to: "src/a.ts", lines: [1], names: ["a"], via: [] }],
    ]);
  });
});

describe("area coupling", () => {
  it("finds areas that import each other even when no file cycle exists", async () => {
    const snapshot = await scan(fixture("coupling"));
    const facts = createFacts(snapshot, null);
    const label = (id: string) => facts.areaLabelOf(id);

    expect(facts.cycles).toEqual([]);
    expect(facts.areaCycles.map((cycle) => cycle.areas.map(label))).toEqual([["src/x", "src/y"]]);
    expect(facts.twoWay.map((pair) => [label(pair.a), label(pair.b), pair.ab, pair.ba])).toEqual([
      ["src/x", "src/y", 1, 1],
    ]);
  });

  it("measures cohesion and instability, and flags stable areas that depend on less stable ones", async () => {
    const facts = createFacts(await scan(fixture("coupling")), null);
    const byLabel = new Map([...facts.areaFacts.values()].map((area) => [area.label, area]));

    expect(byLabel.get("src/x")).toMatchObject({ cohesion: 0.5, instability: 0.33, incoming: 2, outgoing: 1 });
    expect(byLabel.get("src/z")).toMatchObject({ instability: 1, cycle: null });
    expect(
      facts.violations.map((link) => [facts.areaLabelOf(link.from), facts.areaLabelOf(link.to), link.imports]),
    ).toEqual([["src/x", "src/y", 1]]);
  });
});
