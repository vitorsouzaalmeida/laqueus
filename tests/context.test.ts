import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPages } from "../src/report/pages/index";
import { createFacts } from "../src/report/facts";
import type { GraphSnapshot } from "../src/model";
import { buildTree, partNames } from "../src/scan/parts";
import { fixture, scan } from "./helpers";

const pagesOf = (snapshot: GraphSnapshot, exportedAt = "2026-10-20T12:00:00.000Z", scope?: string) => {
  const tree = buildTree(snapshot);
  const result = buildPages(createFacts(snapshot), tree, { exportedAt, logic: false, ...(scope ? { scope } : {}) });

  if (!result.ok) throw new Error(result.error);

  return { pages: result.value, tree };
};

describe("context pages", () => {
  it("writes one page per part, named like the parts of laqueus list", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages, tree } = pagesOf(snapshot);
    const names = partNames(tree);
    const expected = [...tree.nodes.values()]
      .filter((node) => node.kind !== "root")
      .map((node) => (node.children.length > 0 ? `${names.get(node.id)}/_index.md` : `${names.get(node.id)}.md`));

    expected.forEach((page) => expect(pages.has(page)).toBe(true));
    expect(pages.has("server/_index.md")).toBe(true);
    expect(pages.get("server/src-lib.md")).toContain("- Kind: area");
    expect([...pages.keys()].filter((page) => page.startsWith("src/"))).toEqual([]);
  });

  it("maps every source file to its part page", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const files = pagesOf(snapshot).pages.get("_files.md") ?? "";

    const lines = files.split("\n");

    snapshot.modules.forEach((module) =>
      expect(lines.some((line) => line.startsWith(`- \`${module.path}\` → \``) && line.endsWith(".md`"))).toBe(true),
    );
    expect(files).toContain("- `src/lib/server/db.ts` → `server/src-lib.md`");
  });

  it("starts every page with a one-line summary", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages } = pagesOf(snapshot);

    pages.forEach((content, page) => {
      const [first = "", second] = content.split("\n");

      expect({ page, first }).not.toEqual({ page, first: "" });
      expect({ page, heading: first.startsWith("#") }).toEqual({ page, heading: false });
      expect({ page, second }).toEqual({ page, second: "" });
    });
  });

  it("writes lists, never tables", async () => {
    const { pages } = pagesOf(await scan(fixture("sveltekit-sides")));

    pages.forEach((content, page) => expect({ page, table: /^\|/m.test(content) }).toEqual({ page, table: false }));
  });

  it("describes every file of a part on the part page, as greppable facts", async () => {
    const { pages } = pagesOf(await scan(fixture("topology")));
    const part = pages.get("code/src.md") ?? "";

    expect(part).toContain("### `src/a.ts`");
    expect(part).toContain("- Cycle: #1 (`src/b.ts`)");
    expect(part).toContain("- Fan-in: 1 (low, P0 of 2 ranked code files)");
    expect(part).toContain("- Fan-in: 0 (not ranked: entry point)");
    expect(part).toContain("- Role: ");
    expect(part).toContain("- Visibility fan-in: 3");
    expect(pages.get("_cycles.md")).toContain("## Cycle #1");
  });

  it("keeps the export time on the start page only", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const first = pagesOf(snapshot, "2026-10-20T12:00:00.000Z").pages;
    const second = pagesOf(snapshot, "2026-10-21T08:30:00.000Z").pages;
    const changed = [...first.keys()].filter((page) => first.get(page) !== second.get(page));

    expect(changed).toEqual(["_index.md"]);
    expect(second.get("_index.md")).toContain("- Exported: 2026-10-21T08:30:00.000Z");
  });

  it("labels cycle severity, loops and what it takes to break a cycle", async () => {
    const cycles = pagesOf(await scan(fixture("topology"))).pages.get("_cycles.md") ?? "";

    expect(cycles).toContain("- Severity: minor");
    expect(cycles).toContain("- Loops: 1");
    expect(cycles).toContain("- Smallest cut: 1 import, 2 choices (every choice of up to 2 imports was tried)");
    expect(cycles).toContain("  - Choice 1: `src/a.ts` → `src/b.ts` (line 1: `b`)");
    expect(cycles).toContain("- Without type imports: the same cycle");
  });

  it("writes the definitions of every judgement", async () => {
    const definitions = pagesOf(await scan(fixture("topology"))).pages.get("_definitions.md") ?? "";

    [
      "## CC band",
      "## Branches",
      "## Inclusive CC",
      "## Excess CC",
      "## Fan-in band, Fan-out band",
      "## Visibility fan-in, Visibility fan-out",
      "## Role",
      "## Cycle severity",
      "## Loops",
      "## Layer order",
      "## Widely used files",
    ].forEach((heading) => expect(definitions).toContain(heading));
    expect(definitions).not.toContain("## Hub");
    expect(definitions).not.toContain("## Island");
  });

  it("shows the judgement bands on the index page and links health first", async () => {
    const index = pagesOf(await scan(fixture("sveltekit-sides"))).pages.get("_index.md") ?? "";

    expect(index).toContain("## Judgement bands");
    expect(index).toContain("- Visibility medians, server:");
    expect(index).toContain("- Fan-in, client: ");
    expect(index.indexOf("_health.md")).toBeLessThan(index.indexOf("_findings.md"));
  });

  it("writes findings, areas and health pages", async () => {
    const { pages } = pagesOf(await scan(fixture("coupling")));
    const findings = pages.get("_findings.md") ?? "";
    const areas = pages.get("_areas.md") ?? "";
    const health = pages.get("_health.md") ?? "";

    expect(findings.split("\n")[0]).toBe(
      "Findings: 0 functions in the high CC band · 0 functions holding logic in inner functions · 0 cycles",
    );
    expect(findings).toContain("## Complexity by side");
    expect(findings).toContain("- code: 33.3% (1 of 3 imports between areas) point back");
    expect(areas).toContain("- Layer order: `src/z`, `src/x`, `src/y`");
    expect(areas).toContain("- `src/y/y3.ts` → `src/x/x3.ts` (line 1: `x3`)");
    expect(areas).toContain("- `src/x` and `src/y`: 1 → and 1 ←");
    expect(health).toContain("## Code (code), 9 files");
    expect(health).toContain("- Imports pointing back: 33.3% (1 of 3 imports between areas)");
    expect(health).toContain("- Modularity of folders:");
  });

  it("shows imports through re-exports and type-only imports on part pages", async () => {
    const { pages } = pagesOf(await scan(fixture("barrels")));
    const all = [...pages.values()].join("\n");

    expect(all).toContain("- Barrel: yes");
    expect(all).toContain("  - `src/lib/alpha.ts` (line 1, via `src/lib/index.ts`)");
    expect(all).toContain("  - `src/lib/types.ts` (line 4, types only)");
  });

  it("details only the functions worth a look", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "laqueus-notable-"));

    try {
      await mkdir(path.join(root, "src"));
      await writeFile(
        path.join(root, "src", "rules.ts"),
        `export const simple = (a: boolean) => (a ? 1 : 0);
export const pick = (n: number) => {
  if (n === 1) return "a";
  if (n === 2) return "b";
  if (n === 3) return "c";
  if (n === 4) return "d";
  if (n === 5) return "e";
  if (n === 6) return "f";
  if (n === 7) return "g";
  if (n === 8) return "h";
  if (n === 9) return "i";
  if (n === 10) return "j";
  if (n === 11) return "k";
  return n > 0 && n < 100 ? "many" : "none";
};
`,
      );

      const { pages } = pagesOf(await scan(root));
      const part =
        [...pages.entries()].find(([page]) => page.startsWith("code/") && !page.endsWith("_index.md"))?.[1] ?? "";

      expect(part).toContain("#### `pick` (line 2)");
      expect(part).toContain("- CC: 14");
      expect(part).toContain("- Branches: 13");
      expect(part).not.toContain("#### `simple`");
      expect(part).toContain("- Functions above CC 10: 1");
      expect(part).toContain("- Excess CC: 4");
      expect(pages.get("_findings.md")).toContain("- `src/rules.ts` (`");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes only the pages of one part when scoped", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages } = pagesOf(snapshot, "2026-10-20T12:00:00.000Z", "side:server");
    const partPages = [...pages.keys()].filter((page) => !page.startsWith("_"));

    expect(partPages.toSorted()).toEqual(["server/_index.md", "server/src-lib.md"]);
    expect(pages.get("_index.md")).toContain("- Files in scope: 5 of 15");
    expect(pages.get("_files.md")).toContain("`src/lib/server/db.ts` → `server/src-lib.md`");
    expect(pages.get("_files.md")).not.toContain("`src/lib/format.ts`");
    expect(pages.get("server/src-lib.md")).toContain("(not in this export)");
  });

  it("refuses an unknown scope", async () => {
    const snapshot = await scan(fixture("topology"));
    const tree = buildTree(snapshot);

    expect(buildPages(createFacts(snapshot), tree, { exportedAt: "x", logic: false, scope: "side:nowhere" }).ok).toBe(
      false,
    );
  });
});
