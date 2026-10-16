import type { Edge, Node } from "@xyflow/svelte";
import type { Side } from "../src/model";
import { type ColorMode, card, ccBucket, itemLabel, stub } from "./graph";
import type { Point } from "./layered";
import type { MapItem, MapView } from "./map";

export type Shape = { kind: "rect"; halfWidth: number; halfHeight: number } | { kind: "circle"; radius: number };

export type MapNodeData = {
  kind: MapItem["kind"];
  label: string;
  side: Side;
  bucket: number;
  entry: boolean;
  cyclic: boolean;
};

export type MapEdgeData = {
  width: number;
  label: string;
  bend: number;
  sourceShape: Shape;
  targetShape: Shape;
};

export type MapFlowNode = Node<MapNodeData, "map">;
export type MapFlowEdge = Edge<MapEdgeData, "map">;

export type MapScene = { nodes: MapFlowNode[]; edges: MapFlowEdge[]; center: string | null };

export type Emphasis = {
  focus: string | null;
  around: ReadonlySet<string>;
  outgoing: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
};

export type MapContext = {
  readonly emphasis: Emphasis;
  readonly selected: string | null;
  readonly color: ColorMode;
  open: (id: string) => void;
};

export type ViewportControls = { fit: () => void };

export const mapContext = Symbol("map-graph");

export const fileDot = (entry: boolean) => (entry ? 30 : 24);

const shapeOf = (item: MapItem): Shape =>
  item.kind === "group"
    ? { kind: "rect", halfWidth: card.width / 2, halfHeight: card.height / 2 }
    : item.kind === "stub"
      ? { kind: "rect", halfWidth: stub.width / 2, halfHeight: stub.height / 2 }
      : { kind: "circle", radius: fileDot(item.entries > 0) / 2 };

const fallbackShape: Shape = { kind: "circle", radius: 0 };

export const mapScene = (view: MapView, positions: ReadonlyMap<string, Point>, center: string | null): MapScene => {
  const cards = view.mode === "cards";
  const shapes = new Map(view.items.map((item) => [item.id, shapeOf(item)]));
  const pairs = new Set(view.links.map((link) => `${link.from}->${link.to}`));
  return {
    center,
    nodes: view.items.map((item) => ({
      id: item.id,
      type: "map",
      position: { ...(positions.get(item.id) ?? { x: 0, y: 0 }) },
      data: {
        kind: item.kind,
        label: itemLabel(item),
        side: item.side ?? "code",
        bucket: ccBucket(item.maxCC),
        entry: item.kind === "file" && item.entries > 0,
        cyclic: item.kind !== "stub" && item.cyclic,
      },
    })),
    edges: view.links.map((link) => ({
      id: link.id,
      type: "map",
      source: link.from,
      target: link.to,
      data: {
        width: cards ? Math.min(7, 1.4 + Math.log2(link.count) * 0.9) : 1.6,
        label: cards || link.from.startsWith("stub:") || link.to.startsWith("stub:") ? String(link.count) : "",
        bend: pairs.has(`${link.to}->${link.from}`) ? 40 : 0,
        sourceShape: shapes.get(link.from) ?? fallbackShape,
        targetShape: shapes.get(link.to) ?? fallbackShape,
      },
    })),
  };
};

const none: Emphasis = { focus: null, around: new Set(), outgoing: new Set(), incoming: new Set() };

export const emphasisOf = (scene: Pick<MapScene, "nodes" | "edges">, focus: string | null): Emphasis => {
  if (focus === null) return none;
  const edge = scene.edges.find((candidate) => candidate.id === focus);
  if (edge) {
    return { focus, around: new Set([edge.id, edge.source, edge.target]), outgoing: new Set([edge.id]), incoming: new Set() };
  }
  if (!scene.nodes.some((node) => node.id === focus)) return none;
  const outgoing = scene.edges.filter((candidate) => candidate.source === focus);
  const incoming = scene.edges.filter((candidate) => candidate.target === focus);
  return {
    focus,
    around: new Set([
      focus,
      ...outgoing.flatMap((candidate) => [candidate.id, candidate.target]),
      ...incoming.flatMap((candidate) => [candidate.id, candidate.source]),
    ]),
    outgoing: new Set(outgoing.map((candidate) => candidate.id)),
    incoming: new Set(incoming.map((candidate) => candidate.id)),
  };
};

const boundary = (shape: Shape, center: Point, toward: Point): Point => {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return center;
  const reach =
    shape.kind === "circle"
      ? shape.radius
      : Math.min(
          dx === 0 ? Infinity : shape.halfWidth / Math.abs(dx / length),
          dy === 0 ? Infinity : shape.halfHeight / Math.abs(dy / length),
        );
  const distance = Math.min(reach, length);
  return { x: center.x + (dx / length) * distance, y: center.y + (dy / length) * distance };
};

const format = (point: Point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`;

/** A quadratic curve between two node outlines, bent sideways when the pair links both ways. */
export const edgeGeometry = (source: Point, target: Point, data: MapEdgeData) => {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = {
    x: (source.x + target.x) / 2 + (-dy / length) * data.bend,
    y: (source.y + target.y) / 2 + (dx / length) * data.bend,
  };
  const start = boundary(data.sourceShape, source, control);
  const tip = boundary(data.targetShape, target, control);
  const reach = Math.hypot(tip.x - control.x, tip.y - control.y) || 1;
  const direction = { x: (tip.x - control.x) / reach, y: (tip.y - control.y) / reach };
  const arrowLength = 7 + data.width * 1.4;
  const arrowHalf = 3.5 + data.width * 0.7;
  const base = { x: tip.x - direction.x * arrowLength, y: tip.y - direction.y * arrowLength };
  const end = { x: tip.x - direction.x * arrowLength * 0.8, y: tip.y - direction.y * arrowLength * 0.8 };
  return {
    path: `M ${format(start)} Q ${format(control)} ${format(end)}`,
    arrow: [
      tip,
      { x: base.x - direction.y * arrowHalf, y: base.y + direction.x * arrowHalf },
      { x: base.x + direction.y * arrowHalf, y: base.y - direction.x * arrowHalf },
    ]
      .map(format)
      .join(" "),
    label: {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * tip.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * tip.y,
    },
  };
};
