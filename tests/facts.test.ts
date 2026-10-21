import { describe, expect, it } from "vitest";
import { fileLogic } from "../src/analyze";
import { branchStep, createFacts } from "../src/facts";
import type { FunctionLogic, GraphSnapshot } from "../src/model";
import { buildTree, traySides } from "../src/tree";
import { buildView } from "../viewer/map";
import { fixture, scan } from "./helpers";

const treeOf = (snapshot: GraphSnapshot) => buildTree(snapshot, { grouping: "areas", tray: new Set(traySides) });

const allLogic = async (snapshot: GraphSnapshot) => {
  const files = [...new Set(snapshot.functions.map((fn) => fn.location.file))];
  const results = await Promise.all(files.map((file) => fileLogic(snapshot, file)));
  return new Map<string, FunctionLogic>(results.flatMap((result) => (result.ok ? [...result.value] : [])));
};

describe("export facts", () => {
  it("counts a group of files and the imports around it", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const facts = createFacts(snapshot, null);
    const all = facts.stats(snapshot.modules.map((module) => module.id));

    expect(all.files).toBe(snapshot.modules.length);
    expect(all.functions).toBe(snapshot.functions.length);
    expect(all.imports).toEqual({
      internal: snapshot.dependencyEdges.filter((edge) => edge.from !== edge.to).length,
      incoming: 0,
      outgoing: 0,
    });
  });

  it("counts crossings and child stats the way the viewer map does", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const facts = createFacts(snapshot, null);
    const tree = treeOf(snapshot);
    const node = tree.nodes.get("side:server");

    if (!node) throw new Error("side:server missing");

    const trail = ["root", "side:server"];
    const crossings = facts.crossings(node.moduleIds, (id) =>
      branchStep(trail, [...(tree.pathOf.get(id) ?? ["root"]), id]),
    );
    const view = buildView(snapshot, tree, "side:server");
    const inside = view.items.filter((item) => !item.id.startsWith("stub:")).map((item) => item.id);
    const linkCount = (from: string, to: string) =>
      view.links.filter((link) => link.from === from && link.to === to).reduce((sum, link) => sum + link.count, 0);

    expect(crossings.length).toBeGreaterThan(0);
    crossings.forEach((crossing) => {
      const stub = `stub:${crossing.key}`;
      expect(inside.reduce((sum, id) => sum + linkCount(stub, id), 0)).toBe(crossing.incoming);
      expect(inside.reduce((sum, id) => sum + linkCount(id, stub), 0)).toBe(crossing.outgoing);
    });

    buildView(snapshot, tree, "root").items.forEach((card) => {
      const stats = facts.stats(card.moduleIds);
      expect(card.entries).toBe(stats.entryPoints);
      expect(card.maxCC).toBe(stats.maxCC);
    });
  });

  it("numbers cycles from 1 like the viewer", async () => {
    const snapshot = await scan(fixture("topology"));
    const facts = createFacts(snapshot, null);
    const a = snapshot.modules.find((module) => module.path === "src/a.ts");

    expect(facts.cycles).toEqual([{ number: 1, files: ["src/a.ts", "src/b.ts"] }]);
    expect(a && facts.file(a).cycle).toBe(1);
  });

  it("lists every file a route reaches", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const facts = createFacts(snapshot, null);

    expect(facts.routes.some((route) => route.reach.server.includes("src/lib/server/db.ts"))).toBe(true);
  });

  it("explains every CC with its decisions, unless logic is left out", async () => {
    const snapshot = await scan(fixture("sveltekit"));
    const withLogic = createFacts(snapshot, await allLogic(snapshot));
    const functions = snapshot.modules.flatMap((module) => withLogic.functionsOf(module.id));

    expect(functions.length).toBeGreaterThan(0);
    functions.forEach((fn) => {
      expect(1 + (fn.logic?.decisions ?? []).reduce((sum, decision) => sum + decision.weight, 0)).toBe(fn.cc);
      expect(fn.logic?.waysOut).toBeGreaterThan(0);
    });

    const without = createFacts(snapshot, null);
    expect(snapshot.modules.flatMap((module) => without.functionsOf(module.id)).every((fn) => fn.logic === null)).toBe(
      true,
    );
  });
});
