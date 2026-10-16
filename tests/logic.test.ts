import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSource } from "../src/analyze";
import { descendants, isFunction } from "../src/ast";
import { buildLogic } from "../src/logic";
import { cyclomaticComplexity } from "../src/metrics";
import type { FunctionLogic } from "../src/model";

const logicOf = (code: string, fileName = "logic.ts"): FunctionLogic[] => {
  const parsed = parseSource("/virtual", `/virtual/${fileName}`, code);
  if (!parsed.ok) throw new Error(parsed.error.message);
  const { roots, keys } = parsed.value;
  return roots
    .flatMap((root) => descendants(root, keys))
    .filter(isFunction)
    .map((fn, index) =>
      buildLogic({ fn, name: `fn${index}`, file: fileName, code, keys, complexity: cyclomaticComplexity(fn, keys) }),
    );
};

const edgeList = (logic: FunctionLogic) => {
  const label = (id: string) => logic.nodes.find((node) => node.id === id)?.label.split("\n")[0];
  return logic.edges.map((edge) => `${label(edge.from)} -[${edge.label || edge.kind}]-> ${label(edge.to)}`);
};

const sampleSource = `
function createOrder(input: string, items: { qty: number }[]) {
  const user = load(input);
  if (!user || user.disabled) return 401;
  for (const item of items) {
    if (item.qty <= 0) continue;
    save(item);
  }
  try {
    commit();
  } catch (error) {
    log(error);
    throw error;
  } finally {
    close();
  }
  return "ok";
}
`;

describe("function logic", () => {
  it("builds a statement-level flowchart", () => {
    const [logic] = logicOf(sampleSource);
    if (!logic) throw new Error("missing logic");
    expect(logic.nodes.map((node) => node.kind)).toEqual([
      "start",
      "block",
      "decision",
      "return",
      "loop",
      "decision",
      "block",
      "try",
      "catch",
      "block",
      "block",
      "throw",
      "finally",
      "block",
      "return",
    ]);
    expect(edgeList(logic)).toEqual(
      expect.arrayContaining([
        "if (!user || user.disabled) -[true]-> return 401",
        "if (!user || user.disabled) -[false]-> for (const item of items)",
        "for (const item of items) -[each]-> if (item.qty <= 0)",
        "if (item.qty <= 0) -[true · continue]-> for (const item of items)",
        "save(item); -[next]-> for (const item of items)",
        "for (const item of items) -[done]-> try",
        "try -[on error]-> catch (error)",
        "commit(); -[normal]-> finally",
        'close(); -[normal]-> return "ok"',
      ]),
    );
    expect(logic.nodes.find((node) => node.kind === "block")?.calls).toEqual(["load"]);
  });

  it("explains the complexity score decision by decision", () => {
    const [logic] = logicOf(sampleSource);
    const weights = (logic?.nodes ?? []).filter((node) => node.weight > 0).map((node) => [node.label.split("\n")[0], node.weight]);
    expect(weights).toEqual([
      ["if (!user || user.disabled)", 2],
      ["for (const item of items)", 1],
      ["if (item.qty <= 0)", 1],
      ["catch (error)", 1],
    ]);
    expect(logic?.complexity).toBe(6);
  });

  it("writes a readable outline", () => {
    const [logic] = logicOf(sampleSource);
    const flatten = (items: FunctionLogic["outline"], depth = 0): string[] =>
      items.flatMap((item) => [`${"  ".repeat(depth)}${item.text}`, ...flatten(item.children, depth + 1)]);
    expect(flatten(logic?.outline ?? [])).toEqual([
      "Call load",
      "If !user || user.disabled",
      "  Return 401",
      "For each const item of items",
      "  If item.qty <= 0",
      "    Skip to the next iteration",
      "  Call save",
      "Try",
      "  Call commit",
      "If it fails (error)",
      "  Call log",
      "  Throw error",
      "Finally (always runs)",
      "  Call close",
      'Return "ok"',
    ]);
  });

  it("keeps finally reachable when every path in the try returns", () => {
    const [logic] = logicOf(`
function load() {
  try {
    return fetchIt();
  } finally {
    cleanup();
  }
  after();
}`);
    if (!logic) throw new Error("missing logic");
    expect(edgeList(logic)).toContain("try -[always runs]-> finally");
    expect(logic.nodes.find((node) => node.kind === "finally")?.unreachable).toBe(false);
    expect(logic.nodes.find((node) => node.label === "after();")?.unreachable).toBe(true);
    expect(logic.nodes.some((node) => node.kind === "end")).toBe(false);
  });

  it("handles switch fallthrough, labelled breaks, do-while and unreachable code", () => {
    const [logic] = logicOf(`
function route(kind: string) {
  outer: do {
    switch (kind) {
      case "a":
      case "b":
        go();
        break;
      case "c":
        break outer;
      default:
        other();
    }
  } while (retry());
  return 1;
  dead();
}`);
    if (!logic) throw new Error("missing logic");
    expect(edgeList(logic)).toEqual(
      expect.arrayContaining([
        'switch (kind) -[case "a"]-> go();',
        'switch (kind) -[case "b"]-> go();',
        "go(); -[break]-> while (retry())",
        'switch (kind) -[case "c" · break]-> return 1',
        "other(); -[normal]-> while (retry())",
        "while (retry()) -[true]-> switch (kind)",
        "while (retry()) -[false]-> return 1",
      ]),
    );
    expect(logic.nodes.find((node) => node.label === "dead();")?.unreachable).toBe(true);
    expect(logic.nodes.some((node) => node.kind === "end")).toBe(false);
  });

  it("adds up to each function's complexity score", async () => {
    const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const sources = await Promise.all(
      ["analyze.ts", "resolve.ts", "structure.ts", "areas.ts", "logic.ts"].map((file) => readFile(path.join(fixtures, file), "utf8")),
    );
    const mismatches = sources
      .flatMap((code) => logicOf(code))
      .filter((logic) => logic.nodes.reduce((sum, node) => sum + node.weight, 1) !== logic.complexity)
      .map((logic) => `${logic.name}: ${logic.nodes.reduce((sum, node) => sum + node.weight, 1)} vs ${logic.complexity}`);
    expect(mismatches).toEqual([]);
  });

  it("covers Svelte script functions and expression-bodied arrows", () => {
    const logic = logicOf(
      `<script lang="ts">
  const pick = (a?: number) => a ?? 0;
</script>
<p>{pick()}</p>`,
      "Pick.svelte",
    );
    expect(logic.map((item) => item.nodes.map((node) => `${node.kind}:${node.label}`))).toEqual([
      ["start:fn0(a?: number)", "return:return a ?? 0"],
    ]);
  });
});
