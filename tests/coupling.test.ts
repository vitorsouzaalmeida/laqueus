import { describe, expect, it } from "vitest";
import { analyzeCode, fixture, scan } from "./helpers";
import { createFacts } from "../src/report/facts";
import { fewestBackLinks } from "../src/graph/layers";
import { cycleGroups, smallestCuts } from "../src/graph/cycles";
import { visibility } from "../src/graph/visibility";
import { breadthFirst, chainTo } from "../src/graph/reach";
import type { DependencyEdge } from "../src/model";

const edge = (from: string, to: string, typeOnly = false): DependencyEdge => ({
  kind: "imports",
  from,
  to,
  occurrences: [],
  names: ["*"],
  via: [],
  typeOnly,
});

const link = (from: string, to: string, imports = 1) => ({ from, to, imports, names: imports });

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

  it("prefixes named inner functions with the function holding them", () => {
    expect(
      analyzeCode(
        "inner.ts",
        "function outer() {\n  function inner() {}\n  const arrow = () => inner();\n}\n",
      ).functions.map((fn) => fn.name),
    ).toEqual(["outer", "outer › inner", "outer › arrow"]);
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

  it("does not count a file that imports itself as a cycle", () => {
    expect(cycleGroups(["a"], [edge("a", "a")]).size).toBe(0);
    expect([...cycleGroups(["a", "b"], [edge("a", "a"), edge("a", "b"), edge("b", "a")]).keys()]).toEqual(["a", "b"]);
  });

  it("attaches the cuts and the imported names to each cycle", async () => {
    const facts = createFacts(await scan(fixture("topology")));

    expect(facts.cycles[0]?.cuts).toEqual([
      [{ from: "src/a.ts", to: "src/b.ts", lines: [1], names: ["b"], via: [], typeOnly: false }],
      [{ from: "src/b.ts", to: "src/a.ts", lines: [1], names: ["a"], via: [], typeOnly: false }],
    ]);
    expect(facts.cycles[0]).toMatchObject({
      search: "all",
      severity: { severity: "minor", edges: 2, loops: 1 },
      withoutTypes: { files: 2, cycles: 1 },
      reach: { fanIn: 3, fanOut: 2, pairs: 6 },
    });
  });
});

describe("fewest imports pointing back", () => {
  it("finds the order with the fewest imports pointing back, exactly for small graphs", () => {
    const result = fewestBackLinks(
      ["a", "b", "c"],
      [link("a", "b"), link("b", "c"), link("c", "a"), link("b", "a", 3)],
    );

    expect(result).toEqual({ order: ["b", "c", "a"], back: [link("a", "b")], approximate: false });
  });

  it("breaks ties by the fewest imported names", () => {
    const result = fewestBackLinks(
      ["a", "b"],
      [
        { from: "a", to: "b", imports: 1, names: 4 },
        { from: "b", to: "a", imports: 1, names: 1 },
      ],
    );

    expect(result.back).toEqual([{ from: "b", to: "a", imports: 1, names: 1 }]);
  });

  it("uses a heuristic on large graphs and keeps only imports that still close a loop", () => {
    const nodes = Array.from({ length: 30 }, (_, index) => `n${String(index).padStart(2, "0")}`);
    const ring = nodes.map((node, index) => link(node, nodes[(index + 1) % nodes.length] ?? node));
    const result = fewestBackLinks(nodes, ring);

    expect(result.approximate).toBe(true);
    expect(result.back).toHaveLength(1);
    expect(result.order).toHaveLength(30);
  });

  it("cuts a cycle too large to try every pair of imports", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => `f${String(index).padStart(2, "0")}`);
    const dense = nodes.flatMap((from) => nodes.filter((to) => to !== from).map((to) => edge(from, to)));
    const cuts = smallestCuts(nodes, dense);
    const order = fewestBackLinks(
      nodes,
      dense.map((item) => link(item.from, item.to)),
    );

    expect(cuts).toEqual([]);
    expect(order.back).toHaveLength(66);
    expect(order.approximate).toBe(false);
  });
});

describe("visibility", () => {
  it("counts the files reached and reaching, the file itself included", () => {
    const reach = visibility(["a", "b", "c", "d"], [edge("a", "b"), edge("b", "c"), edge("c", "b")]);

    expect(Object.fromEntries(reach)).toEqual({
      a: { fanIn: 1, fanOut: 3 },
      b: { fanIn: 3, fanOut: 2 },
      c: { fanIn: 3, fanOut: 2 },
      d: { fanIn: 1, fanOut: 1 },
    });
  });
});

describe("area coupling", () => {
  it("finds two-way dependencies and the layer order of a side's areas", async () => {
    const snapshot = await scan(fixture("coupling"));
    const facts = createFacts(snapshot);
    const label = (id: string) => facts.areaLabelOf(id);

    expect(facts.cycles).toEqual([]);
    expect(facts.twoWay.map((pair) => [label(pair.a), label(pair.b), pair.ab, pair.ba])).toEqual([
      ["src/x", "src/y", 1, 1],
    ]);
    expect(facts.layers.map((layers) => ({ ...layers, order: layers.order.map(label) }))).toEqual([
      {
        side: "code",
        order: ["src/z", "src/x", "src/y"],
        back: [{ from: "src/y/y3.ts", to: "src/x/x3.ts", lines: [1], names: ["x3"], via: [], typeOnly: false }],
        between: 3,
        approximate: false,
      },
    ]);
  });

  it("measures cohesion and instability within the side", async () => {
    const facts = createFacts(await scan(fixture("coupling")));
    const byLabel = new Map([...facts.areaFacts.values()].map((area) => [area.label, area]));

    expect(byLabel.get("src/x")).toMatchObject({ cohesion: 0.5, instability: 0.33, incoming: 2, outgoing: 1 });
    expect(byLabel.get("src/z")).toMatchObject({ instability: 1 });
  });
});

describe("deep and dense graphs", () => {
  it("finds cycles in long import chains without running out of stack", () => {
    const nodes = Array.from({ length: 20000 }, (_, index) => `f${index}`);
    const chain = nodes.slice(1).map((node, index) => edge(nodes[index] ?? "", node));

    expect(cycleGroups(nodes, chain).size).toBe(0);
    expect(cycleGroups(nodes, [...chain, edge(nodes.at(-1) ?? "", nodes[0] ?? "")]).size).toBe(20000);
  });

  it("tries every pair of imports even when a cycle has hundreds", () => {
    const nodes = Array.from({ length: 21 }, (_, index) => `n${String(index).padStart(2, "0")}`);
    const forward = nodes.flatMap((from, index) => nodes.slice(index + 1).map((to) => edge(from, to)));
    const back = [edge("n20", "n00"), edge("n19", "n01")];

    expect(forward.length + back.length).toBeGreaterThan(200);
    expect(smallestCuts(nodes, [...forward, ...back])).toEqual([back]);
  });

  it("finds no cut when there is no cycle", () => {
    expect(smallestCuts(["a", "b"], [edge("a", "b")])).toEqual([]);
  });

  it("ignores imports of files outside the graph when counting visibility", () => {
    const reach = visibility(["a", "b"], [edge("b", "x"), edge("x", "y")]);

    expect(reach.get("a")).toEqual({ fanIn: 1, fanOut: 1 });
  });

  it("explains reach through the first importer found at every level", () => {
    const graph = new Map([
      ["s", ["a", "b"]],
      ["a", ["c"]],
      ["b", ["c"]],
      ["c", ["d"]],
    ]);
    const reach = breadthFirst(["s"], (node) => graph.get(node) ?? []);

    expect(chainTo(reach, "d")).toEqual(["s", "a", "c", "d"]);
  });

  it("explains reach along a chain longer than the call stack", () => {
    const reach = breadthFirst(["0"], (node) => (Number(node) < 30000 ? [String(Number(node) + 1)] : []));

    expect(chainTo(reach, "30000")).toHaveLength(30001);
  });
});
