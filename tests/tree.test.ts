import { describe, expect, it } from "vitest";
import { buildTree, findPart, partNames } from "../src/scan/parts";
import { byText, uniqueNames } from "../src/model";
import { fixture, kitPackage, scan, withProject } from "./helpers";

const setup = async () => {
  const snapshot = await scan(fixture("sveltekit-sides"));
  const tree = buildTree(snapshot);
  return { tree, names: partNames(tree) };
};

describe("part names", () => {
  it("names sides by their key and areas by a slug under their side", async () => {
    const { tree, names } = await setup();

    expect(names.get("root")).toBe("");
    expect(tree.root.children.map((id) => names.get(id))).toEqual([
      "client",
      "shared",
      "server",
      "unreached",
      "tooling",
    ]);
    expect(tree.nodes.get("side:server")?.children.map((id) => names.get(id))).toEqual(["server/src-lib"]);
  });

  it("finds a side and a nested area by name", async () => {
    const { tree, names } = await setup();

    expect(findPart(tree, names, "server")).toMatchObject({ ok: true, value: { id: "side:server" } });
    expect(findPart(tree, names, "/server/src-lib/")).toMatchObject({ ok: true, value: { kind: "area" } });
  });

  it("names the choices at the deepest level that matched", async () => {
    const { tree, names } = await setup();

    expect(findPart(tree, names, "server/nope")).toEqual({
      ok: false,
      error: 'No part "server/nope". Inside server: server/src-lib.',
    });
    expect(findPart(tree, names, "nope")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Top level: client"),
    });
  });
});

const folder = (name: string) =>
  Object.fromEntries([1, 2, 3, 4].map((n) => [`src/lib/${name}/f${n}.ts`, `export const v${n} = ${n};`]));

describe("unique names", () => {
  it("numbers repeated names, skipping names already in use", () => {
    expect(uniqueNames(["a-b", "a-b", "a-b-2"])).toEqual(["a-b", "a-b-3", "a-b-2"]);
    expect(uniqueNames(["x", "x"], ["x"])).toEqual(["x-2", "x-3"]);
  });

  it("never gives two parts the same name", async () => {
    const files = {
      "package.json": kitPackage,
      "src/routes/+page.svelte": "<p>x</p>",
      ...folder("a-b"),
      ...folder("a_b"),
      ...folder("a-b-2"),
    };

    await withProject(files, async (root) => {
      const names = [...partNames(buildTree(await scan(root))).values()];

      expect(new Set(names).size).toBe(names.length);
    });
  });

  it("sorts text the same way whatever the machine's language", () => {
    expect(["z.ts", "aa.ts", "Zeta.ts", "b.ts"].toSorted(byText)).toEqual(["aa.ts", "b.ts", "z.ts", "Zeta.ts"]);
  });
});
