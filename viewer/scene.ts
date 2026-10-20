import type { Node } from "@xyflow/svelte";
import type { Side } from "../src/model";
import type { FlowItem } from "./flow";
import type { ColorMode } from "./graph";
import type { Point } from "../src/model";

export type Shape = { kind: "rect"; halfWidth: number; halfHeight: number } | { kind: "circle"; radius: number };

export type BoxData = { kind: "card" | "stub"; label: string; side: Side; bucket: number; cyclic: boolean };

export type DotData = {
  kind: "dot";
  label: string;
  side: Side;
  bucket: number;
  cyclic: boolean;
  entry: boolean;
  /** "side" follows the colour mode; "bucket" is always coloured by complexity. */
  tint: "side" | "bucket";
  captionWidth: number;
  fontSize: number;
};

export type FlowData = { kind: "flow"; flowKind: FlowItem["kind"]; label: string; unreachable: boolean };

export type NodeData = BoxData | DotData | FlowData;

/** A node before layout. */
export type SceneNode = { id: string; width: number; height: number; data: NodeData };

export type EdgeData = {
  route: "link" | "step";
  width: number;
  label: string;
  /** Sideways offset of the curve, so two-way links do not overlap. */
  bend: number;
  line: "solid" | "dashed" | "dotted";
  color: string;
  labelColor: string;
};

export type SceneEdge = { id: string; source: string; target: string; data: EdgeData };

export type Scene = { nodes: SceneNode[]; edges: SceneEdge[] };

export type GraphNode = Node<NodeData>;
/** Edges are drawn by EdgeLayer, not Svelte Flow; the z-index lifts highlighted ones above the rest. */
export type GraphEdge = SceneEdge & { zIndex: number };

export type Look = {
  dim: ReadonlySet<string>;
  outgoing: ReadonlySet<string>;
  incoming: ReadonlySet<string>;
  path: ReadonlySet<string>;
  hidden: ReadonlySet<string>;
};

export type LookFn = (focus: string | null) => Look;

export type Viewport = { x: number; y: number; zoom: number };

/** Leaf centres to apply; `fit` refits the view afterwards. */
export type Layout = { centers: ReadonlyMap<string, Point>; fit: boolean };

/** Where the view starts once a graph is mounted. */
export type ViewPlacement = "fit" | { center: string } | { viewport: Viewport } | { top: string };

export type GraphControls = {
  fit: () => void;
  center: (id: string) => void;
  viewport: () => Viewport;
  positions: () => Map<string, Point>;
};

export type GraphContext = {
  mark: (id: string) => number;
  readonly color: ColorMode;
  readonly shapes: ReadonlyMap<string, Shape>;
  select: (id: string) => void;
  open: (id: string) => void;
};

export const graphContext = Symbol("graph");

const nothing: ReadonlySet<string> = new Set();

export const plainLook: Look = { dim: nothing, outgoing: nothing, incoming: nothing, path: nothing, hidden: nothing };

export const mark = { dim: 1, outgoing: 2, incoming: 4, path: 8, selected: 16 } as const;

export const markOf = (look: Look, selected: string | null, id: string): number =>
  (look.dim.has(id) ? mark.dim : 0) |
  (look.outgoing.has(id) ? mark.outgoing : 0) |
  (look.incoming.has(id) ? mark.incoming : 0) |
  (look.path.has(id) ? mark.path : 0) |
  (selected === id ? mark.selected : 0);

export const has = (flags: number, flag: number) => (flags & flag) !== 0;

export const edgeZ = { normal: 2, raised: 3 } as const;
const nodeZ = 4;

export const toFlowNodes = (
  scene: Pick<Scene, "nodes">,
  centers: ReadonlyMap<string, Point>,
  hidden: ReadonlySet<string>,
): GraphNode[] =>
  scene.nodes.map((node) => {
    const center = centers.get(node.id) ?? { x: 0, y: 0 };
    return {
      id: node.id,
      type: node.data.kind === "stub" ? "card" : node.data.kind,
      position: { x: center.x - node.width / 2, y: center.y - node.height / 2 },
      width: node.width,
      height: node.height,
      measured: { width: node.width, height: node.height },
      zIndex: nodeZ,
      hidden: hidden.has(node.id),
      data: node.data,
    };
  });

type Placed = Pick<Node, "id" | "position" | "width" | "height">;

export const centersOf = (nodes: readonly Placed[]): Map<string, Point> =>
  new Map(
    nodes.map((node) => [
      node.id,
      { x: node.position.x + (node.width ?? 0) / 2, y: node.position.y + (node.height ?? 0) / 2 },
    ]),
  );

export const shapeOf = (node: GraphNode): Shape =>
  node.data.kind === "dot"
    ? { kind: "circle", radius: (node.width ?? 0) / 2 }
    : { kind: "rect", halfWidth: (node.width ?? 0) / 2, halfHeight: (node.height ?? 0) / 2 };

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

/** A triangle with its tip at `tip`, pointing along `direction` (a unit vector). */
export const arrowHead = (tip: Point, direction: Point, width: number) => {
  const length = 7 + width * 1.4;
  const half = 3.5 + width * 0.7;
  const base = { x: tip.x - direction.x * length, y: tip.y - direction.y * length };

  return {
    points: [
      tip,
      { x: base.x - direction.y * half, y: base.y + direction.x * half },
      { x: base.x + direction.y * half, y: base.y - direction.x * half },
    ]
      .map(format)
      .join(" "),
    /** Where the line should stop so it does not poke through the tip. */
    end: { x: tip.x - direction.x * length * 0.8, y: tip.y - direction.y * length * 0.8 },
  };
};

const unit = (from: Point, to: Point): Point => {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
};

const loopGeometry = (shape: Shape, center: Point, width: number) => {
  const halfWidth = shape.kind === "circle" ? shape.radius : shape.halfWidth;
  const halfHeight = shape.kind === "circle" ? shape.radius : shape.halfHeight;
  const start = { x: center.x + halfWidth * 0.5, y: center.y - halfHeight };
  const tip = { x: center.x - halfWidth * 0.5, y: center.y - halfHeight };
  const lift = 36 + halfHeight * 0.2;
  const first = { x: start.x + 26, y: start.y - lift };
  const second = { x: tip.x - 26, y: tip.y - lift };
  const arrow = arrowHead(tip, unit(second, tip), width);

  return {
    path: `M ${format(start)} C ${format(first)} ${format(second)} ${format(arrow.end)}`,
    arrow: arrow.points,
    label: { x: center.x, y: center.y - halfHeight - lift * 0.75 },
  };
};

/** A quadratic curve between two node outlines, bent sideways when the pair links both ways. */
export const linkGeometry = (
  source: Point,
  target: Point,
  shapes: { source: Shape; target: Shape },
  options: { width: number; bend: number; loop: boolean },
) => {
  const { width, bend } = options;

  if (options.loop) return loopGeometry(shapes.source, source, width);

  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  const control = {
    x: (source.x + target.x) / 2 + (-dy / length) * bend,
    y: (source.y + target.y) / 2 + (dx / length) * bend,
  };
  const start = boundary(shapes.source, source, control);
  const tip = boundary(shapes.target, target, control);
  const arrow = arrowHead(tip, unit(control, tip), width);

  return {
    path: `M ${format(start)} Q ${format(control)} ${format(arrow.end)}`,
    arrow: arrow.points,
    label: {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * tip.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * tip.y,
    },
  };
};

export type EdgeTone = "outgoing" | "incoming" | "dim" | "normal";

export const edgeTone = (flags: number): EdgeTone =>
  has(flags, mark.outgoing | mark.selected)
    ? "outgoing"
    : has(flags, mark.incoming)
      ? "incoming"
      : has(flags, mark.dim)
        ? "dim"
        : "normal";

export const edgePaint = (tone: EdgeTone, flags: number, data: EdgeData) => ({
  stroke: {
    outgoing: "var(--edge-strong)",
    incoming: "var(--edge-in)",
    dim: "var(--dim)",
    normal: data.color,
  }[tone],
  label: {
    outgoing: "var(--edge-strong)",
    incoming: "var(--edge-in)",
    dim: "var(--dim-text)",
    normal: data.labelColor,
  }[tone],
  width: tone === "outgoing" || tone === "incoming" ? 2.6 : has(flags, mark.path) ? 3 : data.width,
  dash: data.line === "dashed" ? "6 4" : data.line === "dotted" ? "2 3" : undefined,
});

export const noShape: Shape = { kind: "circle", radius: 0 };
