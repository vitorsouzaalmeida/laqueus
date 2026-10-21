import { describe, expect, it } from "vitest";
import { analyzeCode, fixture, scan } from "./helpers";

const edgesOf = (snapshot: Awaited<ReturnType<typeof scan>>, from: string) =>
  snapshot.dependencyEdges
    .filter((edge) => edge.from === `module:${from}`)
    .map((edge) => ({
      to: edge.to.replace("module:", ""),
      names: edge.names,
      via: edge.via.map((id) => id.replace("module:", "")),
    }))
    .toSorted((a, b) => a.to.localeCompare(b.to));

const moduleOf = (snapshot: Awaited<ReturnType<typeof scan>>, path: string) =>
  snapshot.modules.find((module) => module.path === path);

describe("barrels", () => {
  it("follows named imports through a barrel to the files that define them", async () => {
    const snapshot = await scan(fixture("barrels"));

    expect(edgesOf(snapshot, "src/main.ts")).toEqual([
      { to: "src/lib/alpha.ts", names: ["alpha"], via: ["src/lib/index.ts"] },
      { to: "src/lib/beta.ts", names: ["beta"], via: ["src/lib/index.ts"] },
      { to: "src/lib/gamma.ts", names: ["default"], via: ["src/lib/index.ts"] },
      { to: "src/lib/index.ts", names: ["*"], via: [] },
    ]);
  });

  it("marks re-export-only files as barrels and keeps their own re-export edges", async () => {
    const snapshot = await scan(fixture("barrels"));

    expect(moduleOf(snapshot, "src/lib/index.ts")?.barrel).toBe(true);
    expect(moduleOf(snapshot, "src/lib/alpha.ts")?.barrel).toBe(false);
    expect(edgesOf(snapshot, "src/lib/index.ts").map((edge) => edge.to)).toEqual([
      "src/lib/alpha.ts",
      "src/lib/beta.ts",
      "src/lib/gamma.ts",
    ]);
  });

  it("does not report a cycle when a file imports another one through its own barrel", async () => {
    const snapshot = await scan(fixture("barrels"));

    expect(edgesOf(snapshot, "src/lib/alpha.ts")).toEqual([
      { to: "src/lib/beta.ts", names: ["beta"], via: ["src/lib/index.ts"] },
    ]);
    expect(snapshot.modules.every((module) => module.metrics.cycleGroup === null)).toBe(true);
  });

  it("counts test importers apart from fan-in", async () => {
    const snapshot = await scan(fixture("barrels"));

    expect(moduleOf(snapshot, "src/lib/alpha.ts")?.metrics).toMatchObject({ fanIn: 2, testFanIn: 1 });
    expect(moduleOf(snapshot, "src/lib/index.ts")?.metrics).toMatchObject({ fanIn: 1, testFanIn: 0 });
  });

  it("does not treat a file with code of its own as a barrel", () => {
    const mixed = analyzeCode("mixed.ts", `export { a } from "./a";\nexport const b = 1;\n`);
    const pure = analyzeCode(
      "pure.ts",
      `import { a } from "./a";\nexport { a };\nexport * from "./b";\nexport type { T } from "./t";\n`,
    );

    expect(mixed.exports.barrel).toBe(false);
    expect(pure.exports).toMatchObject({
      barrel: true,
      reexports: [{ name: "a", specifier: "./a", imported: "a" }],
      stars: ["./b"],
    });
  });
});
