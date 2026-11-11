import { describe, expect, it } from "vitest";
import { createFacts } from "../src/report/facts";
import { analyzeCode, edgePairs, fixture, kitPackage, scan, withProject } from "./helpers";

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
      .filter((edge) => edge.from === "src/main.ts")
      .map((edge) => `${edge.to.replace("", "")}${edge.typeOnly ? " (types)" : ""}`)
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
      (edge) => edge.from === "src/main.ts" && edge.to === "src/helper.ts",
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
      .filter((fn) => fn.moduleId === "src/lib/Widget.svelte")
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
    .filter((edge) => edge.from === from)
    .map((edge) => ({
      to: edge.to.replace("", ""),
      names: edge.names,
      via: edge.via.map((id) => id.replace("", "")),
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
    expect(createFacts(snapshot).cycles[0]).toMatchObject({ withoutTypes: { files: 0, cycles: 0 } });
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

const scanned = (files: Readonly<Record<string, string>>) => withProject(files, scan);

const warnings = (snapshot: Awaited<ReturnType<typeof scan>>) =>
  snapshot.diagnostics.map((diagnostic) => `${diagnostic.file}: ${diagnostic.message}`);

describe("tsconfig handling", () => {
  it("skips a paths entry that is not a list instead of failing the scan", async () => {
    const snapshot = await scanned({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": "src/*" } } }),
      "src/a.ts": "export const a = 1;",
      "src/b.ts": 'import { a } from "@/a";\nexport const b = a;',
    });

    expect(snapshot.modules).toHaveLength(2);
    expect(warnings(snapshot)).toEqual(['src/b.ts: Cannot resolve "@/a" to a source file']);
  });

  it("follows the project references of a solution-style tsconfig", async () => {
    const snapshot = await scanned({
      "tsconfig.json": JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      "tsconfig.app.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } }, include: ["src"] }),
      "src/lib/a.ts": "export const a = 1;",
      "src/b.ts": 'import { a } from "@/lib/a";\nexport const b = a;',
    });

    expect(edgePairs(snapshot)).toEqual(["src/b.ts -> src/lib/a.ts"]);
    expect(snapshot.modules.flatMap((module) => module.externals)).toEqual([]);
  });

  it("resolves bare imports against baseUrl, Svelte components included", async () => {
    const snapshot = await scanned({
      "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
      "src/components/Card.svelte": "<p>card</p>",
      "src/main.ts": 'import Card from "components/Card.svelte";\nexport default Card;',
    });

    expect(edgePairs(snapshot)).toEqual(["src/main.ts -> src/components/Card.svelte"]);
  });

  it("keeps packages external under a catch-all path", async () => {
    const snapshot = await scanned({
      "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "*": ["./src/*"] } } }),
      "src/util.ts": "export const u = 1;",
      "src/main.ts": 'import { z } from "zod";\nimport { u } from "util";\nexport const x = [z, u];',
    });

    expect(edgePairs(snapshot)).toEqual(["src/main.ts -> src/util.ts"]);
    expect(snapshot.modules.find((module) => module.path === "src/main.ts")?.externals).toEqual(["zod"]);
    expect(snapshot.diagnostics).toEqual([]);
  });
});

describe("special imports", () => {
  it("ignores SvelteKit's own modules and warns about unknown aliases", async () => {
    const snapshot = await scanned({
      "package.json": kitPackage,
      "src/routes/x/+page.ts": [
        'import type { PageLoad } from "./$types";',
        'import { browser } from "$app/environment";',
        'import { env } from "$env/dynamic/public";',
        'import Card from "$components/Card.svelte";',
        "export const load: PageLoad = () => ({ browser, env, Card });",
      ].join("\n"),
    });

    expect(warnings(snapshot)).toEqual([
      'src/routes/x/+page.ts: Cannot resolve "$components/Card.svelte" to a source file',
    ]);
  });

  it("drops imports of a file's text or URL but keeps workers", async () => {
    const snapshot = await scanned({
      "src/m.ts": "export const m = 1;",
      "src/w.ts": "export const w = 1;",
      "src/main.ts": 'import raw from "./m.ts?raw";\nimport W from "./w.ts?worker";\nexport const s = [raw, W];',
    });

    expect(edgePairs(snapshot)).toEqual(["src/main.ts -> src/w.ts"]);
  });

  it("reads type imports written in JSDoc comments", () => {
    const { imports } = analyzeCode(
      "page.server.js",
      "/** @typedef {import('$lib/server/db').Db} Db */\n/** @param {import(\"./x\")} y */\nexport const load = (y) => y;",
    );

    expect(
      imports.map(({ specifier, names, typeOnly, location }) => [specifier, names, typeOnly, location.line]),
    ).toEqual([
      ["$lib/server/db", ["Db"], true, 1],
      ["./x", ["*"], true, 2],
    ]);
  });

  it("marks an import through a type-only re-export as types only", async () => {
    const snapshot = await scanned({
      "src/t.ts": "export type T = number;\nexport const v = 1;",
      "src/barrel.ts": 'export type { T } from "./t";\nexport { v } from "./t";',
      "src/types.ts": 'import { T } from "./barrel";\nexport const n: T = 1;',
      "src/values.ts": 'import { v } from "./barrel";\nexport const n = v;',
    });
    const edgeTo = (from: string) =>
      snapshot.dependencyEdges.find((edge) => edge.from === from && edge.to === "src/t.ts");

    expect(edgeTo("src/types.ts")?.typeOnly).toBe(true);
    expect(edgeTo("src/values.ts")?.typeOnly).toBe(false);
  });
});

describe("awkward Svelte files", () => {
  it("parses a component that starts with a byte order mark", async () => {
    const snapshot = await scanned({
      "src/A.svelte": '\uFEFF<script>\n  import { f } from "./f";\n  const a = f();\n</script>\n<p>{a}</p>\n',
      "src/f.ts": "export const f = () => 1;",
    });

    expect(snapshot.diagnostics).toEqual([]);
    expect(edgePairs(snapshot)).toEqual(["src/A.svelte -> src/f.ts"]);
  });

  it("parses a script whose last statement has no semicolon before </script>", () => {
    expect(analyzeCode("B.svelte", "<script>let a = 1</script><p>x</p>").functions.map((fn) => fn.name)).toEqual([
      "<template>",
    ]);
  });
});
