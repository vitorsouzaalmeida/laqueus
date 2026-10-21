import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { table } from "../src/context/markdown";
import { buildPages } from "../src/context/pages";
import { createFacts } from "../src/facts";
import type { GraphSnapshot } from "../src/model";
import { buildTree, traySides } from "../src/tree";
import { fixture, scan } from "./helpers";

const pagesOf = (snapshot: GraphSnapshot, exportedAt = "2026-10-20T12:00:00.000Z", scope?: string) => {
  const tree = buildTree(snapshot, { grouping: "areas", tray: new Set(traySides) });
  const result = buildPages(createFacts(snapshot, null), tree, { exportedAt, ...(scope ? { scope } : {}) });

  if (!result.ok) throw new Error(result.error);

  return { pages: result.value, tree };
};

const directoriesOf = (snapshot: GraphSnapshot) =>
  new Set(
    snapshot.modules.flatMap((module) =>
      module.path
        .split("/")
        .slice(0, -1)
        .map((_, index, parts) => parts.slice(0, index + 1).join("/")),
    ),
  );

describe("context pages", () => {
  it("mirrors the source tree: a page per file, an index per directory", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages } = pagesOf(snapshot);

    expect(pages.has("_index.md")).toBe(true);
    snapshot.modules.forEach((module) => expect(pages.has(`${module.path}.md`)).toBe(true));
    directoriesOf(snapshot).forEach((directory) => expect(pages.has(`${directory}/_index.md`)).toBe(true));
  });

  it("lists every entry of a directory in its index", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const index = pagesOf(snapshot).pages.get("src/lib/_index.md") ?? "";

    ["`components/`", "`server/`", "`client-only.ts`", "`format.ts`", "`format.test.ts`", "`orphan.ts`"].forEach(
      (entry) => expect(index).toContain(`| ${entry} |`),
    );
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
    snapshot.modules.forEach((module) =>
      expect(pages.get(`${module.path}.md`)?.startsWith(`${module.path}: ${module.placement.side} · `)).toBe(true),
    );
  });

  it("writes one map page per node of the viewer's tree", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages, tree } = pagesOf(snapshot);
    const mapPages = [...pages.keys()].filter((page) => page.startsWith("_map/") && page.endsWith("/_index.md"));

    expect(mapPages).toHaveLength(tree.nodes.size);
    expect(pages.get("_map/server/_index.md")).toContain("- Kind: side");
  });

  it("writes facts as greppable lines", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);

    expect(pages.get("src/a.ts.md")).toContain("- Cycle: #1 (`src/b.ts`)");
    expect(pages.get("src/lone.ts.md")).toContain("- Cycle: none");
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

  it("escapes pipes inside table cells", () => {
    expect(table(["Name"], [["a|b"]])).toContain("| a\\|b |");
  });

  it("adds band lines to every file page", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);
    const population = snapshot.modules.length;

    snapshot.modules.forEach((module) => {
      const content = pages.get(`${module.path}.md`) ?? "";
      expect(content).toContain(`of ${population} files)`);
      expect(content).toContain("- Fan-in band:");
      expect(content).toContain("- Fan-out band:");
      expect(content).toContain("- Hub:");
    });
  });

  it("classifies fan-in using project percentiles", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);

    expect(pages.get("src/b.ts.md")).toContain("- Fan-in band: moderate");
    expect(pages.get("src/lone.ts.md")).toContain("- Fan-in band: low (P0");
  });

  it("marks CC band on functions", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);
    const bPage = pages.get("src/b.ts.md") ?? "";

    expect(bPage).toContain("- CC band: low");
  });

  it("labels cycle severity and density", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);
    const cycles = pages.get("_cycles.md") ?? "";

    expect(cycles).toContain("- Severity: minor");
    expect(cycles).toContain("- Density:");
  });

  it("shows hub: no for files not in both top quartiles", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);

    expect(pages.get("src/lone.ts.md")).toContain("- Hub: no");
  });

  it("writes judgement band definitions", async () => {
    const snapshot = await scan(fixture("topology"));
    const { pages } = pagesOf(snapshot);
    const defs = pages.get("_definitions.md") ?? "";

    expect(defs).toContain("## CC band");
    expect(defs).toContain("## Fan-in band, Fan-out band");
    expect(defs).toContain("## Hub");
    expect(defs).toContain("## Cycle severity");
    expect(defs).toContain("## Density");
  });

  it("shows the judgement bands section on the index page", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages } = pagesOf(snapshot);
    const index = pages.get("_index.md") ?? "";

    expect(index).toContain("## Judgement bands");
    expect(index).toContain("- Hubs:");
  });

  it("refuses a source tree whose pages would overwrite generated ones", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "laqueus-collision-"));

    try {
      await mkdir(path.join(root, "_map"));
      await writeFile(path.join(root, "_map", "x.ts"), "export const x = 1;\n");

      const snapshot = await scan(root);
      const tree = buildTree(snapshot, { grouping: "areas", tray: new Set(traySides) });
      const result = buildPages(createFacts(snapshot, null), tree, { exportedAt: "2026-10-20T12:00:00.000Z" });

      expect(result.ok).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes only the pages of one part when scoped", async () => {
    const snapshot = await scan(fixture("sveltekit-sides"));
    const { pages } = pagesOf(snapshot, "2026-10-20T12:00:00.000Z", "side:server");
    const server = snapshot.modules.filter((module) => module.placement.side === "server");
    const filePages = [...pages.keys()].filter((page) => !page.startsWith("_") && !page.endsWith("_index.md"));

    expect(filePages.toSorted()).toEqual(server.map((module) => `${module.path}.md`).toSorted());
    expect(
      [...pages.keys()].filter((page) => page.startsWith("_map/")).every((page) => page.startsWith("_map/server/")),
    ).toBe(true);
    expect(pages.get("_index.md")).toContain("- Files in scope: 5 of 16");
    expect(pages.get("src/lib/_index.md")).toContain("| `server/` |");
    expect(pages.get("src/lib/_index.md")).not.toContain("| `format.ts` |");
    expect(pages.has("src/lib/components/_index.md")).toBe(false);
    expect(pages.get("_map/server/_index.md")).toContain("| not in this export |");
  });

  it("refuses an unknown scope", async () => {
    const snapshot = await scan(fixture("topology"));
    const tree = buildTree(snapshot, { grouping: "areas", tray: new Set(traySides) });

    expect(buildPages(createFacts(snapshot, null), tree, { exportedAt: "x", scope: "side:nowhere" }).ok).toBe(false);
  });
});
