import { describe, expect, it } from "vitest";
import { forceLayout } from "../viewer/force";
import { allFilesLook, neighbourhoodLook, pathLook } from "../viewer/looks";
import { type Scene, type SceneNode, centersOf, linkGeometry, nestNodes } from "../viewer/scene";
import { moduleScene, structureCenters } from "../viewer/scenes";
import { fixture, scan } from "./helpers";

const dot = (id: string, parent: string | null = null): SceneNode => ({
  id,
  parent,
  width: 20,
  height: 20,
  data: { kind: "dot", label: id, side: "code", bucket: 1, cyclic: false, entry: false, tint: "side", captionWidth: 20, fontSize: 10 },
});

const link = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  data: { route: "link" as const, width: 1.4, label: "", bend: 0, line: "solid" as const, color: "", labelColor: "" },
});

const chain: Scene = { nodes: [dot("a"), dot("b"), dot("c"), dot("d")], edges: [link("a", "b"), link("b", "c")] };

describe("nesting", () => {
  const scene = {
    nodes: [
      dot("x", "box"),
      dot("y", "box"),
      { id: "box", parent: null, width: 0, height: 0, data: { kind: "container" as const, variant: "group" as const, label: "", padding: 10 } },
    ],
  };
  const centers = new Map([
    ["x", { x: 0, y: 0 }],
    ["y", { x: 100, y: 50 }],
  ]);

  it("sizes containers around their children and lists parents first", () => {
    const nodes = nestNodes(scene, centers, new Set());
    expect(nodes.map((node) => node.id)).toEqual(["box", "x", "y"]);
    const box = nodes[0];
    expect(box?.position).toEqual({ x: -20, y: -20 });
    expect(box?.width).toBeGreaterThan(120);
    expect(nodes[1]?.parentId).toBe("box");
    expect(nodes[1]?.position).toEqual({ x: 10, y: 10 });
  });

  it("round-trips leaf centres through relative positions", () => {
    const back = centersOf(nestNodes(scene, centers, new Set()));
    expect(back.get("x")).toEqual({ x: 0, y: 0 });
    expect(back.get("y")).toEqual({ x: 100, y: 50 });
  });

  it("shrinks containers to their visible children", () => {
    const full = nestNodes(scene, centers, new Set())[0]?.width ?? 0;
    const narrowed = nestNodes(scene, centers, new Set(["y"]))[0]?.width ?? 0;
    expect(narrowed).toBeLessThan(full);
  });
});

describe("looks", () => {
  it("dims everything outside the hovered node's neighbourhood", () => {
    const look = neighbourhoodLook(chain, "b");
    expect([...look.dim].sort()).toEqual(["d"]);
    expect([...look.outgoing]).toEqual(["b->c"]);
    expect([...look.incoming]).toEqual(["a->b"]);
  });

  it("ignores focus on something that is not in the scene", () => {
    expect(neighbourhoodLook(chain, "missing").dim.size).toBe(0);
  });

  it("follows paths transitively in both directions", () => {
    const look = pathLook(chain, "c");
    expect([...look.path].sort()).toEqual(["a", "a->b", "b", "b->c", "c"]);
    expect([...look.dim]).toEqual(["d"]);
  });
});

describe("all files look", () => {
  it("hides file arrows until something is selected, then shows that file's arrows", async () => {
    const scene = moduleScene(await scan(fixture("topology")));
    const fileEdges = scene.edges.filter((edge) => edge.id.startsWith("imports:")).map((edge) => edge.id);
    expect(fileEdges.every((id) => allFilesLook(scene, null, { focus: false, cyclesOnly: false }).hidden.has(id))).toBe(true);
    const selected = allFilesLook(scene, "module:src/c.ts", { focus: false, cyclesOnly: false });
    expect(selected.hidden.has("imports:module:src/c.ts->module:src/b.ts")).toBe(false);
    expect(selected.outgoing.has("imports:module:src/c.ts->module:src/b.ts")).toBe(true);
    expect(selected.dim.has("module:src/lone.ts")).toBe(true);
  });

  it("keeps only files in cycles when asked", async () => {
    const scene = moduleScene(await scan(fixture("topology")));
    const look = allFilesLook(scene, null, { focus: false, cyclesOnly: true });
    const shown = scene.nodes.filter((node) => node.id.startsWith("module:") && !look.hidden.has(node.id)).map((node) => node.id);
    expect(shown.sort()).toEqual(["module:src/a.ts", "module:src/b.ts"]);
  });
});

describe("geometry and layout", () => {
  it("ends arrows on the target's outline, not its centre", () => {
    const circle = { kind: "circle" as const, radius: 10 };
    const geometry = linkGeometry({ x: 0, y: 0 }, { x: 100, y: 0 }, { source: circle, target: circle }, { width: 1, bend: 0, loop: false });
    expect(geometry.arrow.startsWith("90.0,0.0")).toBe(true);
    expect(geometry.path.startsWith("M 10.0,0.0")).toBe(true);
  });

  it("lays out the same graph the same way every time", async () => {
    const data = await scan(fixture("topology"));
    const nodes = data.modules.map((module) => ({ id: module.id, cluster: module.groupId }));
    const links = data.dependencyEdges.map((edge) => ({ from: edge.from, to: edge.to }));
    const first = forceLayout(nodes, links);
    expect(forceLayout(nodes, links)).toEqual(first);
    expect([...first.values()].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    expect(structureCenters(data).size).toBe(data.modules.length);
  });
});
