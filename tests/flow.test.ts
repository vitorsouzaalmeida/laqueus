import { describe, expect, it } from "vitest";
import { parseSource } from "../src/analyze";
import { allNodes, isFunction } from "../src/ast";
import { buildLogic } from "../src/logic";
import { cyclomaticComplexity } from "../src/metrics";
import { defaultCollapsed, flowPositions, flowView, wrap } from "../viewer/flow";

const code = `
function run(items: number[]) {
  for (const item of items) {
    if (item > 1) {
      big(item);
    } else {
      small(item);
    }
  }
  return done();
}`;

const logic = (() => {
  const parsed = parseSource("/virtual", "/virtual/run.ts", code);

  if (!parsed.ok) throw new Error(parsed.error.message);

  const { roots, keys } = parsed.value;
  const fn = allNodes(roots, keys).find(isFunction);

  if (!fn) throw new Error("missing function");

  return buildLogic({ fn, name: "run", file: "run.ts", code, keys, complexity: cyclomaticComplexity(fn, keys) });
})();

const loopId = logic.nodes.find((node) => node.kind === "loop")?.id ?? "";

describe("flow view", () => {
  it("shows every step when nothing is collapsed", () => {
    const view = flowView(logic, new Set());

    expect(view.items.map((item) => item.kind)).toEqual(["start", "loop", "decision", "block", "block", "return"]);
    expect(view.items.find((item) => item.kind === "decision")?.label).toContain("CC +1");
  });

  it("folds a collapsed loop body into one placeholder and reroutes its edges", () => {
    const view = flowView(logic, new Set([loopId]));

    expect(view.items.map((item) => item.kind)).toEqual(["start", "loop", "return", "collapsed"]);
    expect(view.items.find((item) => item.kind === "collapsed")?.hidden).toBe(3);
    expect(view.links.map((link) => `${link.from}->${link.to}:${link.label}`).toSorted()).toEqual(
      [
        `${loopId}->collapsed:${loopId}:each`,
        `${loopId}->n5:done`,
        `collapsed:${loopId}->${loopId}:next`,
        `n0->${loopId}:`,
      ].toSorted(),
    );
  });

  it("places the start at the top and keeps every item positioned", () => {
    const view = flowView(logic, new Set());
    const positions = flowPositions(view);

    expect(positions.size).toBe(view.items.length);

    const startY = positions.get("n0")?.y ?? 0;

    expect([...positions.values()].every((point) => point.y >= startY)).toBe(true);
  });

  it("only collapses nested branches of large functions by default", () => {
    expect(defaultCollapsed(logic).size).toBe(0);
  });

  it("wraps long labels on word boundaries", () => {
    expect(wrap("if (alpha && beta && gamma)", 12)).toEqual(["if (alpha &&", "beta &&", "gamma)"]);
  });
});
