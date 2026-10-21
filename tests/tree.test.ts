import { describe, expect, it } from "vitest";
import { buildTree, findPart, partNames, traySides } from "../src/tree";
import { fixture, scan } from "./helpers";

const setup = async () => {
  const snapshot = await scan(fixture("sveltekit-sides"));
  const tree = buildTree(snapshot, { grouping: "areas", tray: new Set(traySides) });
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
      "test",
      "tooling",
    ]);
    expect(tree.nodes.get("side:server")?.children.map((id) => names.get(id))).toEqual([
      "server/server-src",
      "server/src-routes",
    ]);
  });

  it("finds a side and a nested area by name", async () => {
    const { tree, names } = await setup();

    expect(findPart(tree, names, "server")).toMatchObject({ ok: true, value: { id: "side:server" } });
    expect(findPart(tree, names, "/server/server-src/")).toMatchObject({ ok: true, value: { kind: "area" } });
  });

  it("names the choices at the deepest level that matched", async () => {
    const { tree, names } = await setup();

    expect(findPart(tree, names, "server/nope")).toEqual({
      ok: false,
      error: 'No part "server/nope". Inside server: server/server-src, server/src-routes.',
    });
    expect(findPart(tree, names, "nope")).toMatchObject({
      ok: false,
      error: expect.stringContaining("Top level: client"),
    });
  });
});
