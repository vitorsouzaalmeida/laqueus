import { describe, expect, it } from "vitest";
import { fileLogic } from "../src/analyze";
import { bandShares, branchStep, createFacts } from "../src/facts";
import type { FunctionLogic, GraphSnapshot } from "../src/model";
import { buildTree, traySides } from "../src/tree";
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

  it("counts the imports crossing out of a part", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const facts = createFacts(snapshot, null);
    const tree = treeOf(snapshot);
    const node = tree.nodes.get("side:server");

    if (!node) throw new Error("side:server missing");

    const trail = ["root", "side:server"];
    const crossings = facts.crossings(node.moduleIds, (id) =>
      branchStep(trail, [...(tree.pathOf.get(id) ?? ["root"]), id]),
    );
    const stats = facts.stats(node.moduleIds);

    expect(crossings.length).toBeGreaterThan(0);
    expect(crossings.every((crossing) => crossing.incoming + crossing.outgoing > 0)).toBe(true);
    expect(crossings.reduce((sum, crossing) => sum + crossing.incoming, 0)).toBe(stats.imports.incoming);
    expect(crossings.reduce((sum, crossing) => sum + crossing.outgoing, 0)).toBe(stats.imports.outgoing);
  });

  it("numbers cycles from 1", async () => {
    const snapshot = await scan(fixture("topology"));
    const facts = createFacts(snapshot, null);
    const a = snapshot.modules.find((module) => module.path === "src/a.ts");

    expect(facts.cycles).toMatchObject([{ number: 1, files: ["src/a.ts", "src/b.ts"] }]);
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

  it("ranks fan-in without entry points and barrels, and fan-out without barrels", async () => {
    const snapshot = await scan(fixture("barrels"));
    const facts = createFacts(snapshot, null);
    const fileOf = (path: string) => {
      const module = snapshot.modules.find((candidate) => candidate.path === path);
      if (!module) throw new Error(`${path} missing`);
      return facts.file(module);
    };

    expect(fileOf("src/main.ts").fanInRank).toBeNull();
    expect(fileOf("src/main.ts").fanOutRank).not.toBeNull();
    expect(fileOf("src/lib/index.ts")).toMatchObject({ fanInRank: null, fanOutRank: null });
    expect(fileOf("src/lib/alpha.ts").fanInRank?.population).toBe(4);
  });

  it("describes each side's health as a whole", async () => {
    const facts = createFacts(await scan(fixture("topology")), null);

    expect(facts.health).toEqual([
      expect.objectContaining({
        side: "code",
        files: 4,
        propagationCost: 0.5,
        largestCycle: 2,
        modularity: expect.objectContaining({ folders: 0 }),
      }),
    ]);
  });

  it("shares decisions out by CC band", () => {
    expect(bandShares([1, 3, 12, 20])).toEqual({ total: 32, low: 2, moderate: 11, high: 19 });
  });
});
