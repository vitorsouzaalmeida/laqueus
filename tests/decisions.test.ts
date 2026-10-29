import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allNodes, isFunction } from "../src/language/ast";
import { waysOut } from "../src/language/decisions";
import { parseSource } from "../src/language/parse";
import { analyzeCode } from "./helpers";

const firstFunction = (code: string) => {
  const parsed = parseSource("/virtual", "/virtual/logic.ts", code);

  if (!parsed.ok) throw new Error(parsed.error.message);

  const fn = allNodes(parsed.value.roots, parsed.value.keys).find(isFunction);

  if (!fn) throw new Error("no function");

  return fn;
};

const decisionsOf = (code: string, fileName = "logic.ts") =>
  analyzeCode(fileName, code).functions.map((fn) => ({
    name: fn.name,
    decisions: fn.decisions.map(
      (decision) => `${decision.line} +${decision.weight} ${decision.kind}: ${decision.label}`,
    ),
    waysOut: fn.waysOut,
  }));

const sampleSource = `function createOrder(input: string, items: { qty: number }[]) {
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
  return input ? "ok" : "empty";
}
`;

describe("decisions", () => {
  it("lists each decision on the line of the statement that holds it", () => {
    expect(decisionsOf(sampleSource)).toEqual([
      {
        name: "createOrder",
        decisions: [
          "3 +2 if: if (!user || user.disabled) return 401;",
          "4 +1 loop: for (const item of items) {",
          "5 +1 if: if (item.qty <= 0) continue;",
          "10 +1 catch: } catch (error) {",
          '16 +1 return: return input ? "ok" : "empty";',
        ],
        waysOut: 3,
      },
    ]);
  });

  it("lists every case of a switch on its own line", () => {
    const [fn] = decisionsOf(`function pick(x: number) {
  switch (x) {
    case 1:
      return "one";
    case 2:
    case 3:
      return "few";
    default:
      return x > 10 && x < 20 ? "teen" : "many";
  }
}
`);

    expect(fn?.decisions).toEqual([
      "3 +1 case: case 1:",
      "5 +1 case: case 2:",
      "6 +1 case: case 3:",
      '9 +2 return: return x > 10 && x < 20 ? "teen" : "many";',
    ]);
    expect(fn?.waysOut).toBe(3);
  });

  it("measures inner functions on their own and lists markup decisions by line", () => {
    expect(
      decisionsOf(
        `<script lang="ts">
  const pick = (a?: number) => (a ? a : 0);
</script>
{#if open}
  {#each items as item}<p>{item && pick(item)}</p>{/each}
{/if}`,
        "Pick.svelte",
      ),
    ).toEqual([
      { name: "pick", decisions: ["2 +1 statement: const pick = (a?: number) => (a ? a : 0);"], waysOut: 1 },
      {
        name: "<template>",
        decisions: ["4 +1 if: {#if open}", "5 +2 loop: {#each items as item}<p>{item && pick(item)}</p>{/each}"],
        waysOut: 1,
      },
    ]);
  });

  it("adds up to each function's complexity score", async () => {
    const sources = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
    const files = [
      "scan/project.ts",
      "language/resolve.ts",
      "scan/sveltekit.ts",
      "graph/areas.ts",
      "language/decisions.ts",
    ];
    const analyses = await Promise.all(
      files.map(async (file) => analyzeCode(path.basename(file), await readFile(path.join(sources, file), "utf8"))),
    );
    const mismatches = analyses
      .flatMap((analysis) => analysis.functions)
      .filter((fn) => fn.decisions.reduce((sum, decision) => sum + decision.weight, 1) !== fn.complexity)
      .map((fn) => fn.name);

    expect(mismatches).toEqual([]);
  });
});

describe("ways out", () => {
  const cases: readonly (readonly [string, number])[] = [
    ["function a() { if (x) return 1; }", 2],
    ["function a() { if (x) return 1; else return 2; }", 2],
    ["function a() { while (true) { return 1; } }", 2],
    ["function a() { for (;;) { if (x) break; } return 2; }", 1],
    ["function a() { do { return 1; } while (x); }", 1],
    ["function a() { do { continue; } while (x); }", 1],
    ["function a() { do { if (x) break; return 1; } while (y); }", 2],
    ["function a() { switch (x) { case 1: return 1; default: return 2; } }", 2],
    ["function a() { switch (x) { case 1: return 1; case 2: return 2; } }", 3],
    ["function a() { switch (x) { case 1: return 1; break; default: return 2; } }", 2],
    ["function a() { switch (x) { case 1: break; default: return 2; } }", 2],
    ["function a() { switch (x) { default: try { return 1 } finally { break } } }", 2],
    ["function a() { switch (x) {} }", 1],
    ["function a() { a: { return 1; break a; } }", 1],
    ["function a() { a: { if (x) break a; return 1; } }", 2],
    ["function a() { a: for (;;) { for (;;) { break a; } } return 3; }", 1],
    ["function a() { b: if (x) { break b; } else { return 1; } }", 2],
    ["function a() { try { return f(); function g(){} } finally { x() } }", 2],
    ["function a() { try { return 1; log(); } finally {} }", 2],
    ["function a() { try { return 1; {} } finally {} }", 1],
    ["function a() { try { return 1; ; } finally {} }", 1],
    ["function a() { try { return 1; } catch (e) { return 2; } }", 2],
    ["function a() { try { return 1; } catch (e) { log(e); } }", 2],
    ["function a() { try { throw 1; } finally { return 2; } }", 2],
    ["function a() { try { x(); } finally { return 2; } }", 1],
    ["function a() { try { return 1 } catch { } finally { } }", 2],
    ["function a() { return 1; return 2; }", 2],
    ["function a() { throw 1; foo(); }", 1],
    ["function a() { return; if (x) { foo() } }", 1],
    ["function a() { with (o) { return 1; } }", 1],
    ["function a() { while (x) { if (y) continue; return 1; } }", 2],
    ["const f = () => x ? 1 : 2;", 1],
    ["const f = () => { };", 1],
  ];

  it.each(cases)("counts %s", (code, expected) => {
    expect(waysOut(firstFunction(code))).toBe(expected);
  });
});
