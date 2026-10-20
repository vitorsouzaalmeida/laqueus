import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AnalysisCache, analyzeProject } from "../src/analyze";
import type { GraphSnapshot } from "../src/model";
import { edgePairs, fixture } from "./helpers";

const scanWith = async (root: string, cache: AnalysisCache): Promise<GraphSnapshot> => {
  const result = await analyzeProject(root, cache);

  if (!result.ok) throw new Error(result.error);

  return result.value;
};

const functionNames = (snapshot: GraphSnapshot) => snapshot.functions.map((fn) => fn.name).toSorted();

describe("analysis cache", () => {
  const state = { workspace: "" };
  const project = () => path.join(state.workspace, "project");

  beforeEach(async () => {
    state.workspace = await mkdtemp(path.join(tmpdir(), "laqueus-cache-"));
    await cp(fixture("topology"), project(), { recursive: true });
  });

  afterEach(async () => {
    await rm(state.workspace, { recursive: true, force: true });
  });

  it("reuses unchanged files and gives the same snapshot as a fresh scan", async () => {
    const cache: AnalysisCache = new Map();
    const first = await scanWith(project(), cache);
    const second = await scanWith(project(), cache);
    const fresh = await scanWith(project(), new Map());

    expect(cache.size).toBe(4);
    expect(second.functions[0]).toBe(first.functions[0]);
    expect({ ...second, scannedAt: "", durationMs: 0 }).toEqual({ ...fresh, scannedAt: "", durationMs: 0 });
  });

  it("re-analyzes edited files and forgets deleted ones", async () => {
    const cache: AnalysisCache = new Map();
    await scanWith(project(), cache);

    await writeFile(path.join(project(), "src/c.ts"), 'import { a } from "./a";\n\nexport const d = () => a();\n');
    await rm(path.join(project(), "src/lone.ts"));
    const after = await scanWith(project(), cache);

    expect(cache.size).toBe(3);
    expect(functionNames(after)).toEqual(["a", "b", "callA", "d"]);
    expect(edgePairs(after)).toContain("src/c.ts -> src/a.ts");
    expect(edgePairs(after)).not.toContain("src/c.ts -> src/b.ts");
  });
});
