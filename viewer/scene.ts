import type { Edge, Node } from "@xyflow/svelte";
import type { Side } from "../src/model";
import type { FlowItem } from "./flow";
import type { ColorMode } from "./graph";
import type { Point } from "./layered";

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

export type ContainerData = { kind: "container"; variant: "lane" | "group"; label: string; padding: number };

export type FlowData = { kind: "flow"; flowKind: FlowItem["kind"]; label: string; unreachable: boolean };

export type NodeData = BoxData | DotData | ContainerData | FlowData;

/** A node before layout. Containers have no size of their own: they wrap their children. */
export type SceneNode = { id: string; parent: string | null; width: number; height: number; data: NodeData };

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
export type GraphEdge = Edge<EdgeData>;

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

export type Placement = "fit" | { center: string } | { viewport: Viewport } | { top: string };

export type GraphControls = {
  fit: () => void;
  center: (id: string) => void;
  viewport: () => Viewport;
  positions: () => Map<string, Point>;
};

export type GraphContext = {
  readonly look: Look;
  readonly selected: string | null;
  readonly color: ColorMode;
  readonly shapes: ReadonlyMap<string, Shape>;
  open: (id: string) => void;
};

export const graphContext = Symbol("graph");

const nothing: ReadonlySet<string> = new Set();

export const plainLook: Look = { dim: nothing, outgoing: nothing, incoming: nothing, path: nothing, hidden: nothing };

export const containerZ = { lane: 0, group: 1 } as const;
export const edgeZ = { normal: 2, raised: 3 } as const;
const leafZ = 4;

type Bounds = { left: number; top: number; right: number; bottom: number };

const captionLines = (label: string) => label.split("\n").length;

/** How much room a leaf takes up, captions included, so containers can wrap around it. */
const leafBounds = (node: SceneNode, center: Point): Bounds => {
  const halfWidth = node.data.kind === "dot" ? Math.max(node.width / 2, node.data.captionWidth / 2) : node.width / 2;
  const below =
    node.data.kind === "dot" ? node.height / 2 + 4 + captionLines(node.data.label) * node.data.fontSize * 1.3 : node.height / 2;
  return { left: center.x - halfWidth, top: center.y - node.height / 2, right: center.x + halfWidth, bottom: center.y + below };
};

const union = (all: readonly Bounds[]): Bounds =>
  all.reduce((acc, next) => ({
    left: Math.min(acc.left, next.left),
    top: Math.min(acc.top, next.top),
    right: Math.max(acc.right, next.right),
    bottom: Math.max(acc.bottom, next.bottom),
  }));

const depthOf = (nodes: ReadonlyMap<string, SceneNode>, node: SceneNode): number =>
  node.parent === null ? 0 : 1 + depthOf(nodes, nodes.get(node.parent) as SceneNode);

/** Room above a group box for its label, which sits outside the box. */
export const groupLabelRoom = 30;

/**
 * Turns leaf centres into Svelte Flow nodes: containers are sized around their visible children,
 * parents come before children, and child positions are relative to their parent's corner.
 */
export const nestNodes = (
  scene: Pick<Scene, "nodes">,
  centers: ReadonlyMap<string, Point>,
  hidden: ReadonlySet<string>,
): GraphNode[] => {
  const byId = new Map(scene.nodes.map((node) => [node.id, node]));
  const children = scene.nodes.reduce(
    (map, node) => (node.parent === null ? map : map.set(node.parent, [...(map.get(node.parent) ?? []), node])),
    new Map<string, SceneNode[]>(),
  );
  const boxes = new Map<string, { x: number; y: number; width: number; height: number }>();
  const outer = new Map<string, Bounds>();
  const resolve = (node: SceneNode): Bounds => {
    const known = outer.get(node.id);
    if (known) return known;
    if (node.data.kind !== "container") {
      const center = centers.get(node.id) ?? { x: 0, y: 0 };
      boxes.set(node.id, { x: center.x - node.width / 2, y: center.y - node.height / 2, width: node.width, height: node.height });
      const bounds = leafBounds(node, center);
      outer.set(node.id, bounds);
      return bounds;
    }
    const members = (children.get(node.id) ?? []).filter((child) => !hidden.has(child.id));
    const inner = members.length > 0 ? union(members.map(resolve)) : { left: 0, top: 0, right: 0, bottom: 0 };
    (children.get(node.id) ?? []).filter((child) => hidden.has(child.id)).forEach(resolve);
    const pad = node.data.padding;
    const box = { x: inner.left - pad, y: inner.top - pad, width: inner.right - inner.left + pad * 2, height: inner.bottom - inner.top + pad * 2 };
    boxes.set(node.id, box);
    const room = node.data.variant === "group" ? groupLabelRoom : 0;
    const bounds = { left: box.x, top: box.y - room, right: box.x + box.width, bottom: box.y + box.height };
    outer.set(node.id, bounds);
    return bounds;
  };
  scene.nodes.forEach(resolve);
  return [...scene.nodes]
    .map((node, order) => ({ node, order, depth: depthOf(byId, node) }))
    .sort((a, b) => a.depth - b.depth || a.order - b.order)
    .map(({ node }) => {
      const box = boxes.get(node.id) as { x: number; y: number; width: number; height: number };
      const parent = node.parent === null ? null : boxes.get(node.parent);
      const lane = node.data.kind === "container" && node.data.variant === "lane";
      return {
        id: node.id,
        type: node.data.kind === "stub" ? "card" : node.data.kind,
        position: { x: box.x - (parent?.x ?? 0), y: box.y - (parent?.y ?? 0) },
        width: box.width,
        height: box.height,
        ...(node.parent === null ? {} : { parentId: node.parent }),
        zIndex: node.data.kind === "container" ? containerZ[node.data.variant] : leafZ,
        hidden: hidden.has(node.id),
        draggable: !lane,
        ...(lane ? { class: "graph-lane" } : {}),
        data: node.data,
      };
    });
};

/** Absolute centres of the given Svelte Flow nodes, following parent links. */
type Placed = Pick<Node, "id" | "position" | "width" | "height" | "parentId">;

export const centersOf = (nodes: readonly Placed[]): Map<string, Point> => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const corner = (node: Placed): Point => {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    const base = parent ? corner(parent) : { x: 0, y: 0 };
    return { x: base.x + node.position.x, y: base.y + node.position.y };
  };
  return new Map(
    nodes.map((node) => {
      const at = corner(node);
      return [node.id, { x: at.x + (node.width ?? 0) / 2, y: at.y + (node.height ?? 0) / 2 }];
    }),
  );
};

export const shapeOf = (node: GraphNode): Shape =>
  node.data.kind === "dot"
    ? { kind: "circle", radius: (node.width ?? 0) / 2 }
    : { kind: "rect", halfWidth: (node.width ?? 0) / 2, halfHeight: (node.height ?? 0) / 2 };

export const toFlowEdges = (scene: Pick<Scene, "edges">): GraphEdge[] =>
  scene.edges.map((edge) => ({
    id: edge.id,
    type: edge.data.route,
    source: edge.source,
    target: edge.target,
    zIndex: edgeZ.normal,
    data: edge.data,
  }));

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

export const edgeTone = (look: Look, selected: string | null, id: string): EdgeTone =>
  look.outgoing.has(id) || selected === id
    ? "outgoing"
    : look.incoming.has(id)
      ? "incoming"
      : look.dim.has(id)
        ? "dim"
        : "normal";

export const edgePaint = (tone: EdgeTone, look: Look, id: string, data: EdgeData | undefined) => ({
  stroke: { outgoing: "var(--edge-strong)", incoming: "var(--edge-in)", dim: "var(--dim)", normal: data?.color ?? "var(--edge)" }[tone],
  label: { outgoing: "var(--edge-strong)", incoming: "var(--edge-in)", dim: "var(--dim-text)", normal: data?.labelColor ?? "var(--muted)" }[
    tone
  ],
  width: tone === "outgoing" || tone === "incoming" ? 2.6 : look.path.has(id) ? 3 : (data?.width ?? 1.4),
  dash: data?.line === "dashed" ? "6 4" : data?.line === "dotted" ? "2 3" : undefined,
});

export const noShape: Shape = { kind: "circle", radius: 0 };
