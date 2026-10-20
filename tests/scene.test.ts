import { describe, expect, it } from "vitest";
import { forceLayout } from "../viewer/force";
import { forceLayoutAsync } from "../viewer/force-async";
import { neighbourhoodLook, pathLook } from "../viewer/looks";
import {
  type Scene,
  type SceneNode,
  centersOf,
  edgeTone,
  linkGeometry,
  mark,
  markOf,
  toFlowNodes,
} from "../viewer/scene";
import { fixture, scan } from "./helpers";

const dot = (id: string): SceneNode => ({
  id,
  width: 20,
  height: 20,
  data: {
    kind: "dot",
    label: id,
    side: "code",
    bucket: 1,
    cyclic: false,
    entry: false,
    tint: "side",
    captionWidth: 20,
    fontSize: 10,
  },
});

const link = (source: string, target: string) => ({
  id: `${source}->${target}`,
  source,
  target,
  data: { route: "link" as const, width: 1.4, label: "", bend: 0, line: "solid" as const, color: "", labelColor: "" },
});

const chain: Scene = { nodes: [dot("a"), dot("b"), dot("c"), dot("d")], edges: [link("a", "b"), link("b", "c")] };

describe("flow nodes", () => {
  const scene = { nodes: [dot("x"), dot("y")] };
  const centers = new Map([
    ["x", { x: 0, y: 0 }],
    ["y", { x: 100, y: 50 }],
  ]);

  it("places nodes by their corner and round-trips their centres", () => {
    const nodes = toFlowNodes(scene, centers, new Set());

    expect(nodes[0]?.position).toEqual({ x: -10, y: -10 });
    expect(centersOf(nodes)).toEqual(centers);
  });

  it("marks hidden nodes and declares every size as measured", () => {
    const nodes = toFlowNodes(scene, centers, new Set(["y"]));

    expect(nodes.map((node) => node.hidden)).toEqual([false, true]);
    expect(nodes.every((node) => node.measured?.width === node.width && node.measured?.height === node.height)).toBe(
      true,
    );
  });
});

describe("looks", () => {
  it("dims everything outside the hovered node's neighbourhood", () => {
    const look = neighbourhoodLook(chain, "b");

    expect([...look.dim].toSorted()).toEqual(["d"]);
    expect([...look.outgoing]).toEqual(["b->c"]);
    expect([...look.incoming]).toEqual(["a->b"]);
  });

  it("turns a look into per-element flags", () => {
    const look = neighbourhoodLook(chain, "b");

    expect(markOf(look, "c", "d")).toBe(mark.dim);
    expect(markOf(look, "c", "c")).toBe(mark.selected);
    expect(edgeTone(markOf(look, null, "a->b"))).toBe("incoming");
    expect(edgeTone(markOf(look, null, "b->c"))).toBe("outgoing");
  });

  it("ignores focus on something that is not in the scene", () => {
    expect(neighbourhoodLook(chain, "missing").dim.size).toBe(0);
  });

  it("follows paths transitively in both directions", () => {
    const look = pathLook(chain, "c");

    expect([...look.path].toSorted()).toEqual(["a", "a->b", "b", "b->c", "c"]);
    expect([...look.dim]).toEqual(["d"]);
  });
});

describe("geometry and layout", () => {
  it("ends arrows on the target's outline, not its centre", () => {
    const circle = { kind: "circle" as const, radius: 10 };
    const geometry = linkGeometry(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { source: circle, target: circle },
      { width: 1, bend: 0, loop: false },
    );

    expect(geometry.arrow.startsWith("90.0,0.0")).toBe(true);
    expect(geometry.path.startsWith("M 10.0,0.0")).toBe(true);
  });

  it("lays out the same graph the same way every time", async () => {
    const data = await scan(fixture("topology"));
    const nodes = data.modules.map((module) => ({ id: module.id }));
    const links = data.dependencyEdges.map((edge) => ({ from: edge.from, to: edge.to }));
    const first = forceLayout(nodes, links);

    expect(forceLayout(nodes, links)).toEqual(first);
    expect([...first.values()].every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
  });

  it("gives the same positions when the layout runs asynchronously", async () => {
    const data = await scan(fixture("topology"));
    const nodes = data.modules.map((module) => ({ id: module.id }));
    const links = data.dependencyEdges.map((edge) => ({ from: edge.from, to: edge.to }));

    expect(await forceLayoutAsync(nodes, links)).toEqual(forceLayout(nodes, links));
  });
});
