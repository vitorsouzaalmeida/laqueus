import * as tsParser from "@typescript-eslint/parser";
import { Linter } from "eslint";
import { describe, expect, it } from "vitest";
import { analyzeCode } from "./helpers";

const cases = `
function a(x: boolean) {
  if (x) return 1;
  return 0;
}
const b = () => {
  const inner = (v: boolean) => (v ? 1 : 0);
  return inner(true);
};
function loops(xs: number[]) {
  for (let i = 0; i < 1; i++) {}
  for (const x of xs) {}
  for (const k in xs) {}
  while (false) {}
  do {} while (false);
}
function choose(x: number) {
  switch (x) {
    case 1: return "one";
    case 2: return "two";
    default: return "many";
  }
}
function guarded() {
  try { return JSON.parse("{}"); } catch { return null; } finally { void 0; }
}
function logical(a: boolean, b: boolean, c: boolean) {
  return (a && b) || c;
}
function assigns(o: { a?: number; b?: number; d: number }) {
  o.a ||= 1;
  o.b &&= 2;
  o.d += 1;
}
class Shapes {
  area(x: number | null) { return x === null ? 0 : x * x; }
  arrow = (y?: number) => y && y > 0;
}
function outer(xs: number[]) {
  if (xs.length === 0) return [];
  return xs.map((x) => {
    return x > 0 ? x : -x;
  });
}
function typed<T extends string>(value: T | null): value is T {
  return value !== null && (value as unknown) !== undefined;
}
const optionalOnly = (v?: number) => v!;
const obj = {
  method(flag: boolean) { return flag ? 1 : 2; },
};
`;

const undefinedChecks = `
function nullish(a: boolean, b: boolean, c?: number) {
  return (a && b) || (c ?? 1);
}
function nullishAssign(o: { c?: number }) {
  o.c ??= 3;
}
function defaults(a = 1, { b = 2 } = {}) {
  return a + b;
}
function chains(a: any) {
  return a?.b?.c() ?? a?.();
}
function telemetry(attributes: Record<string, string>, context?: { userId?: string; teamId?: string }) {
  setAttributeIfPresent(attributes, "userId", context?.userId);
  setAttributeIfPresent(attributes, "teamId", context?.teamId);
}
function ternary(context?: { userId?: string }) {
  return context ? context.userId : undefined;
}
`;

const eslintScores = (code: string) =>
  new Linter({ configType: "flat" })
    .verify(
      code,
      [
        {
          files: ["**/*.ts"],
          languageOptions: { parser: tsParser },
          rules: { complexity: ["error", { max: 0, variant: "classic" }] },
        },
      ],
      "cases.ts",
    )
    .filter((message) => message.ruleId === "complexity" && !message.message.startsWith("Class field"))
    .map((message) => ({
      line: message.line,
      complexity: Number(/complexity of (\d+)/.exec(message.message)?.[1]),
    }))
    .toSorted((x, y) => x.line - y.line);

describe("cyclomatic complexity", () => {
  const functions = analyzeCode("cases.ts", cases).functions;
  const score = (name: string) => functions.find((fn) => fn.name === name)?.complexity;

  it("matches the documented scores", () => {
    expect({
      a: score("a"),
      b: score("b"),
      inner: score("b › inner"),
      loops: score("loops"),
      choose: score("choose"),
      guarded: score("guarded"),
      logical: score("logical"),
      assigns: score("assigns"),
      area: score("Shapes.area"),
      arrow: score("Shapes.arrow"),
      outer: score("outer"),
      typed: score("typed"),
      optionalOnly: score("optionalOnly"),
      method: score("obj.method"),
    }).toEqual({
      a: 2,
      b: 1,
      inner: 2,
      loops: 6,
      choose: 3,
      guarded: 2,
      logical: 3,
      assigns: 3,
      area: 2,
      arrow: 2,
      outer: 2,
      typed: 2,
      optionalOnly: 1,
      method: 2,
    });
  });

  it("scores nested callbacks separately from their parent", () => {
    expect(functions.find((fn) => fn.name === "outer › xs.map callback")).toMatchObject({ complexity: 2 });
  });

  it("adds nothing for checks of undefined values, but counts ternaries", () => {
    const checks = analyzeCode("checks.ts", undefinedChecks).functions;
    const scoreOf = (name: string) => checks.find((fn) => fn.name === name)?.complexity;

    expect({
      nullish: scoreOf("nullish"),
      nullishAssign: scoreOf("nullishAssign"),
      defaults: scoreOf("defaults"),
      chains: scoreOf("chains"),
      telemetry: scoreOf("telemetry"),
      ternary: scoreOf("ternary"),
    }).toEqual({ nullish: 3, nullishAssign: 1, defaults: 1, chains: 1, telemetry: 1, ternary: 2 });
  });

  it("agrees with ESLint's complexity rule", () => {
    const ours = functions
      .map((fn) => ({ line: fn.location.line, complexity: fn.complexity }))
      .toSorted((x, y) => x.line - y.line);
    expect(ours).toEqual(eslintScores(cases));
  });

  it('measures functions in <script lang="ts"> blocks of Svelte files', () => {
    const svelte = analyzeCode(
      "Component.svelte",
      `<script lang="ts">
  function pick(a?: number, b?: number): number {
    if (a) return a;
    return b ?? 0;
  }
</script>
<p>{pick(1) ? "yes" : "no"}</p>`,
    ).functions;
    expect(svelte.map((fn) => ({ name: fn.name, complexity: fn.complexity, line: fn.location.line }))).toEqual([
      { name: "pick", complexity: 2, line: 2 },
      { name: "<template>", complexity: 2, line: 7 },
    ]);
  });
});

describe("complexity beyond one function", () => {
  const measured = analyzeCode(
    "shapes.ts",
    `function list(kind: string, a: boolean, b: boolean) {
  return kind === "a" || kind === "b" || kind === "c" || (a && b);
}
function counter(start: number) {
  let count = start;
  let label = "";
  const fixed = 1;
  const step = () => {
    count += fixed;
    if (count > 10) count = 0;
  };
  const rename = (next?: string) => {
    [label] = [next ?? label];
  };
  return { step, rename };
}
class Box {
  size = 1 > 0 ? 1 : 0;
  grow(by: number) {
    if (by > 0) this.size += by;
  }
}
`,
  );
  const fn = (name: string) => measured.functions.find((candidate) => candidate.name === name);

  it("counts branches apart from conditions", () => {
    expect(fn("list")).toMatchObject({ complexity: 5, branches: 1 });
  });

  it("adds the decisions of inner functions into the inclusive CC", () => {
    expect(fn("counter")).toMatchObject({ complexity: 1, inclusive: 2 });
    expect(fn("counter › step")).toMatchObject({ complexity: 2, inclusive: 2 });
  });

  it("counts the outer let, var and parameters that inner functions assign to", () => {
    expect(fn("counter")?.outerWrites).toBe(2);
    expect(fn("counter › step")?.outerWrites).toBe(0);
  });

  it("measures a class as 1 plus the decisions of its methods and field initialisers", () => {
    expect(measured.classes.map((cls) => ({ name: cls.name, inclusive: cls.inclusive }))).toEqual([
      { name: "Box", inclusive: 3 },
    ]);
  });
});

describe("Svelte templates", () => {
  const component = analyzeCode(
    "List.svelte",
    `<script lang="ts">
  let { items, ok } = $props();
  function go() {}
</script>
{#snippet row(item)}
  <li class:active={item.on || ok}>{item.name ?? "x"}</li>
{/snippet}
{#if ok && items}
  <p>a</p>
{:else if items.length > 2}
  <p>b</p>
{:else}
  <p>c</p>
{/if}
{#each items.filter((i) => i.ok) as item}
  {@render row(item)}
{/each}
{#await go()}
  wait
{:then v}
  {v ? 1 : 2}
{:catch e}
  err
{/await}
<button onclick={() => ok && go()}>x</button>`,
  ).functions;
  const byName = new Map(component.map((fn) => [fn.name, fn]));

  it("measures the markup as one function with its blocks and conditions", () => {
    expect(byName.get("<template>")).toMatchObject({ complexity: 8, branches: 7, location: { line: 5 } });
  });

  it("measures snippets and inline functions on their own", () => {
    expect([...byName.keys()]).toEqual([
      "go",
      "<template>",
      "<template> › row",
      "<template> › items.filter callback",
      "<template> › onclick callback",
    ]);
    expect(byName.get("<template> › row")).toMatchObject({ complexity: 2, branches: 1 });
    expect(byName.get("<template> › onclick callback")).toMatchObject({ complexity: 2 });
    expect(byName.get("<template>")?.inclusive).toBe(10);
  });
});
