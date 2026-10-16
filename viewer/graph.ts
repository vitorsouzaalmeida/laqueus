import cytoscape from "cytoscape";
import type { FunctionNode, GraphSnapshot, ModuleNode, Side } from "../src/model";
import { type LayoutNode, type Point, layered } from "./layered";
import type { FlowView } from "./flow";
import type { MapItem, MapLink, MapView } from "./map";

export type ModuleLayout = "structure" | "force";
export type FunctionLayout = "cose" | "breadthfirst";
export type ColorMode = "side" | "complexity";

export const forceLayoutLimit = 300;
const comfortableZoom = 1.5;
const largeGraph = 600;

export const allSides: readonly Side[] = ["client", "shared", "server", "code", "unreached", "test", "tooling"];

export const ccBucket = (value: number | null) =>
  value === null ? 0 : value < 5 ? 1 : value < 10 ? 2 : value < 20 ? 3 : 4;

export const bucketLabels = ["no functions", "1–4", "5–9", "10–19", "20+"];

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

const card = { width: 240, height: 96 };
const stub = { width: 200, height: 60 };
const fileBox = { width: 180, height: 60 };

export const graphStyle = (color: ColorMode): cytoscape.StylesheetJson => {
  const edge = cssVar("--edge");
  const strong = cssVar("--edge-strong");
  const incoming = cssVar("--edge-in");
  const cycle = cssVar("--cycle");
  const dim = cssVar("--dim");
  const dimText = cssVar("--dim-text");
  const fillable = ["node.file", "node.mapfile", "node.fn", "node.card"];
  return [
    {
      selector: "node",
      style: {
        width: 20,
        height: 20,
        label: "data(label)",
        "font-size": 10,
        color: cssVar("--label"),
        "text-valign": "bottom",
        "text-halign": "center",
        "text-margin-y": 4,
        "text-wrap": "wrap",
        "text-max-width": "160px",
        "min-zoomed-font-size": 8,
        "border-width": 1,
        "border-color": edge,
        "background-color": cssVar("--cc-none"),
      },
    },
    ...[1, 2, 3, 4].map((bucket) => ({
      selector: (color === "complexity" ? fillable : ["node.fn"]).map((part) => `${part}[bucket = ${bucket}]`).join(", "),
      style: { "background-color": cssVar(`--cc-${bucket}`) },
    })),
    ...(color === "side"
      ? allSides.map((side) => ({
          selector: `node.file[side = "${side}"], node.mapfile[side = "${side}"], node.card[side = "${side}"]`,
          style: { "background-color": cssVar(`--side-${side}`) },
        }))
      : []),
    ...allSides.map((side) => ({
      selector: `node.card[side = "${side}"], node.stub[side = "${side}"]`,
      style: { "border-color": cssVar(`--side-${side}`) },
    })),
    { selector: "node[?entry]", style: { shape: "diamond", width: 26, height: 26 } },
    { selector: "node[?cyclic]", style: { "border-width": 3, "border-color": cycle } },
    {
      selector: "node.card",
      style: {
        shape: "round-rectangle",
        width: card.width,
        height: card.height,
        "background-opacity": color === "side" ? 0.16 : 0.45,
        "border-width": 2,
        "text-valign": "center",
        "text-margin-y": 0,
        "text-max-width": `${card.width - 24}px`,
        "font-size": 13,
        "line-height": 1.35,
        color: cssVar("--text"),
        "min-zoomed-font-size": 4,
      },
    },
    { selector: "node.card[?cyclic]", style: { "border-color": cycle, "border-width": 3 } },
    {
      selector: "node.stub",
      style: {
        shape: "round-rectangle",
        width: stub.width,
        height: stub.height,
        "background-color": cssVar("--panel"),
        "background-opacity": 1,
        "border-width": 2,
        "border-style": "dashed",
        "text-valign": "center",
        "text-margin-y": 0,
        "text-max-width": `${stub.width - 20}px`,
        "font-size": 12,
        color: cssVar("--muted"),
        "min-zoomed-font-size": 4,
      },
    },
    {
      selector: "node.mapfile",
      style: {
        width: 24,
        height: 24,
        "font-size": 11,
        "text-max-width": `${fileBox.width - 10}px`,
        "min-zoomed-font-size": 5,
      },
    },
    { selector: "node.mapfile[?entry]", style: { width: 30, height: 30 } },
    {
      selector: "node.lane",
      style: {
        shape: "round-rectangle",
        "background-color": cssVar("--lane"),
        "background-opacity": 1,
        "border-width": 0,
        label: "data(label)",
        "font-size": "data(fontSize)",
        "font-weight": "bold",
        color: cssVar("--muted"),
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": -12,
        "text-wrap": "none",
        "min-zoomed-font-size": 4,
        padding: "40px",
        events: "no",
      },
    },
    {
      selector: "node.group",
      style: {
        shape: "round-rectangle",
        "background-color": cssVar("--group"),
        "background-opacity": 1,
        "border-width": 1,
        "border-color": cssVar("--group-border"),
        label: "data(label)",
        "font-size": "data(fontSize)",
        "font-weight": "bold",
        color: cssVar("--text"),
        "text-valign": "top",
        "text-halign": "center",
        "text-margin-y": (node: cytoscape.NodeSingular) => Number(node.data("labelOffset")),
        "text-max-width": "1000px",
        "min-zoomed-font-size": 5,
        padding: "12px",
      },
    },
    ...flowStyles(),
    { selector: "node:selected", style: { "border-width": 4, "border-color": strong, "font-weight": "bold" } },
    { selector: "node.group:selected", style: { "border-width": 3, "border-color": strong } },
    {
      selector: "edge",
      style: {
        width: 1.4,
        "line-color": edge,
        "target-arrow-color": edge,
        "target-arrow-shape": "triangle",
        "arrow-scale": 0.9,
        "curve-style": "straight",
      },
    },
    { selector: "edge[?loop], edge[?cyclic], edge.map-edge", style: { "curve-style": "bezier" } },
    { selector: "edge[?cyclic]", style: { "line-color": cycle, "target-arrow-color": cycle } },
    {
      selector: "edge.map-edge",
      style: {
        width: "data(width)",
        label: "data(label)",
        "font-size": 11,
        color: cssVar("--muted"),
        "text-background-color": cssVar("--bg"),
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 6,
      },
    },
    {
      selector: "edge.group-edge",
      style: {
        width: "data(width)",
        "line-color": cssVar("--group-edge"),
        "target-arrow-color": cssVar("--group-edge"),
        "arrow-scale": 1.1,
      },
    },
    {
      selector: "edge.outgoing, edge:selected",
      style: { width: 2.6, "line-color": strong, "target-arrow-color": strong, "z-index": 10, color: strong },
    },
    {
      selector: "edge.incoming",
      style: { width: 2.6, "line-color": incoming, "target-arrow-color": incoming, "z-index": 10, color: incoming },
    },
    { selector: "node.dim", style: { "background-color": dim, "border-color": dim, color: dimText } },
    { selector: "node.card.dim, node.stub.dim", style: { opacity: 0.35 } },
    { selector: "edge.dim", style: { "line-color": dim, "target-arrow-color": dim, color: dimText } },
    { selector: ".hidden", style: { display: "none" } },
  ];
};

const flowStyles = (): cytoscape.StylesheetJson => {
  const muted = cssVar("--muted");
  const coloured = (selector: string, variable: string) => ({
    selector,
    style: { "line-color": cssVar(variable), "target-arrow-color": cssVar(variable), color: cssVar(variable) },
  });
  return [
    {
      selector: "node.flow",
      style: {
        shape: "round-rectangle",
        width: "data(width)",
        height: "data(height)",
        label: "data(label)",
        "text-valign": "center",
        "text-halign": "center",
        "text-margin-y": 0,
        "text-wrap": "wrap",
        "text-max-width": "1000px",
        "font-size": 11,
        "line-height": 1.3,
        "min-zoomed-font-size": 5,
        color: cssVar("--text"),
        "background-color": cssVar("--panel"),
        "border-width": 1.5,
        "border-color": cssVar("--edge"),
      },
    },
    { selector: "node.flow-block", style: { "font-family": "ui-monospace, Menlo, Consolas, monospace", "text-justification": "left" } },
    { selector: "node.flow-start", style: { "border-width": 2.5, "border-color": cssVar("--side-shared"), "font-weight": "bold" } },
    { selector: "node.flow-end", style: { "border-color": muted, color: muted } },
    {
      selector: "node.flow-decision, node.flow-switch",
      style: { shape: "diamond", "background-color": cssVar("--decision"), "border-color": cssVar("--decision-border"), "border-width": 2 },
    },
    {
      selector: "node.flow-loop",
      style: { shape: "hexagon", "background-color": cssVar("--loop"), "border-color": cssVar("--loop-border"), "border-width": 2 },
    },
    { selector: "node.flow-try, node.flow-finally", style: { shape: "cut-rectangle", "border-color": muted } },
    { selector: "node.flow-catch", style: { shape: "cut-rectangle", "border-color": cssVar("--flow-throw"), "border-width": 2 } },
    { selector: "node.flow-return", style: { "border-color": cssVar("--flow-return"), "border-width": 2.5 } },
    { selector: "node.flow-throw", style: { "border-color": cssVar("--flow-throw"), "border-width": 2.5 } },
    { selector: "node.flow-collapsed", style: { "border-style": "dashed", "border-color": muted, color: muted } },
    { selector: "node.flow[?unreachable]", style: { "border-style": "dashed", opacity: 0.55 } },
    {
      selector: "edge.flow-edge",
      style: {
        "curve-style": "taxi",
        "taxi-direction": "downward",
        "taxi-turn": 22,
        width: 1.6,
        label: "data(label)",
        "font-size": 10,
        color: muted,
        "text-background-color": cssVar("--bg"),
        "text-background-opacity": 1,
        "text-background-padding": "2px",
        "min-zoomed-font-size": 6,
      },
    },
    coloured("edge.flow-true", "--edge-in"),
    coloured("edge.flow-false", "--flow-false"),
    coloured("edge.flow-case", "--decision-border"),
    { selector: "edge.flow-back", style: { "curve-style": "bezier", "line-style": "dashed", "control-point-step-size": 70 } },
    { selector: "edge.flow-break", style: { "line-style": "dashed" } },
    { ...coloured("edge.flow-exception", "--flow-throw"), style: { ...coloured("edge.flow-exception", "--flow-throw").style, "line-style": "dotted" } },
    { selector: "edge.path", style: { width: 3, "z-index": 10 } },
    { selector: "node.path", style: { "border-width": 3 } },
  ];
};

export const flowElements = (view: FlowView, positions: ReadonlyMap<string, Point>): cytoscape.ElementDefinition[] => [
  ...view.items.map((item) => ({
    group: "nodes" as const,
    classes: `flow flow-${item.kind}`,
    position: { ...(positions.get(item.id) ?? { x: 0, y: 0 }) },
    data: { id: item.id, label: item.label, width: item.width, height: item.height, unreachable: item.unreachable },
  })),
  ...view.links.map((link) => ({
    group: "edges" as const,
    classes: `flow-edge flow-${link.kind}`,
    data: { id: link.id, source: link.from, target: link.to, label: link.label },
  })),
];

export const highlightPaths = (cy: cytoscape.Core, id: string | null) =>
  cy.batch(() => {
    cy.elements().removeClass("dim path outgoing incoming");
    if (!id) return;
    const element = cy.getElementById(id);
    if (element.empty()) return;
    const asEdge = element as unknown as cytoscape.EdgeSingular;
    const along = element.isNode()
      ? element.union(element.predecessors()).union(element.successors())
      : asEdge.union(asEdge.source().predecessors()).union(asEdge.target().successors()).union(asEdge.connectedNodes());
    cy.elements().not(along).addClass("dim");
    along.addClass("path");
  });

const fileLabels = (modules: readonly ModuleNode[]) => {
  const counts = modules.reduce(
    (map, module) => map.set(basename(module.path), (map.get(basename(module.path)) ?? 0) + 1),
    new Map<string, number>(),
  );
  return (module: ModuleNode) =>
    (counts.get(basename(module.path)) ?? 0) > 1 ? module.path.split("/").slice(-2).join("/") : basename(module.path);
};

export const moduleElements = (data: GraphSnapshot): cytoscape.ElementDefinition[] => {
  const labelOf = fileLabels(data.modules);
  const cycleOf = new Map(data.modules.map((module) => [module.id, module.metrics.cycleGroup]));
  const laneCounts = data.modules.reduce(
    (map, module) => map.set(module.placement.side, (map.get(module.placement.side) ?? 0) + 1),
    new Map<string, number>(),
  );
  return [
    ...data.lanes.map((lane) => ({
      group: "nodes" as const,
      classes: "lane",
      data: { id: `lane:${lane.side}`, label: `${lane.label} · ${laneCounts.get(lane.side) ?? 0} files`, fontSize: 30 },
    })),
    ...data.groups.map((group) => ({
      group: "nodes" as const,
      classes: "group",
      data: {
        id: group.id,
        parent: `lane:${group.side}`,
        label: `${group.directory === "." ? "(project root)" : group.directory} · ${group.moduleIds.length}`,
        fontSize: 14,
        labelOffset: 20,
      },
    })),
    ...data.modules.map((module) => ({
      group: "nodes" as const,
      classes: "file",
      position: { ...module.position },
      data: {
        id: module.id,
        parent: module.groupId,
        label: `${labelOf(module)}\nCC ${module.metrics.maxCC ?? "N/A"} · in ${module.metrics.fanIn} · out ${module.metrics.fanOut}`,
        bucket: ccBucket(module.metrics.maxCC),
        side: module.placement.side,
        cyclic: module.metrics.cycleGroup !== null,
        entry: module.placement.entry !== null,
      },
    })),
    ...data.groupEdges.map((edge) => ({
      group: "edges" as const,
      classes: "group-edge",
      data: {
        id: `folders:${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        width: Math.min(5, 1 + Math.log2(edge.count) * 0.6),
      },
    })),
    ...data.dependencyEdges.map((edge) => {
      const from = cycleOf.get(edge.from) ?? null;
      return {
        group: "edges" as const,
        classes: "file-edge hidden",
        data: {
          id: `imports:${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          cyclic: from !== null && from === (cycleOf.get(edge.to) ?? null),
          loop: edge.from === edge.to,
        },
      };
    }),
  ];
};

export const functionElements = (
  functions: readonly FunctionNode[],
  callsFrom: (id: string) => readonly { from: string; to: string }[],
): cytoscape.ElementDefinition[] => [
  ...functions.map((fn) => ({
    group: "nodes" as const,
    classes: "fn",
    data: { id: fn.id, label: `${fn.name}\nCC ${fn.complexity}`, bucket: ccBucket(fn.complexity) },
  })),
  ...functions.flatMap((fn) =>
    callsFrom(fn.id).map((edge) => ({
      group: "edges" as const,
      data: { id: `calls:${edge.from}->${edge.to}`, source: edge.from, target: edge.to, loop: edge.from === edge.to },
    })),
  ),
];

const itemSize = (item: MapItem) => (item.kind === "group" ? card : item.kind === "stub" ? stub : fileBox);

const itemLabel = (item: MapItem) => {
  if (item.kind === "file") return `${item.label}\nCC ${item.maxCC ?? "N/A"}`;
  const files = `${item.moduleIds.length} file${item.moduleIds.length === 1 ? "" : "s"}`;
  if (item.kind === "stub") return `${item.label}\n${files} outside this view`;
  const entries = item.entries === 1 ? "1 entry" : `${item.entries} entries`;
  const details = [files, item.entries > 0 ? entries : null, `max CC ${item.maxCC ?? "N/A"}`]
    .filter(Boolean)
    .join(" · ");
  return `${item.label}\n${details}`;
};

const stubRank = (item: MapItem, links: readonly MapLink[]): LayoutNode["rank"] => {
  if (item.kind !== "stub") return undefined;
  const outgoing = links.some((link) => link.from === item.id);
  const incoming = links.some((link) => link.to === item.id);
  return outgoing && !incoming ? "top" : incoming && !outgoing ? "bottom" : undefined;
};

const layoutColumn = (items: readonly MapItem[], links: readonly MapLink[], cards: boolean) =>
  layered(
    items.map((item) => ({ id: item.id, ...itemSize(item), rank: stubRank(item, links) })),
    links,
    cards ? { maxPerRow: 5, gapX: 50, gapY: 90 } : { maxPerRow: 7, gapX: 24, gapY: 70 },
  );

export const sidesPositions = (items: readonly MapItem[], traySides: ReadonlySet<Side>): Map<string, Point> => {
  const main = items.filter((item) => item.kind === "group" && !traySides.has(item.side as Side));
  const tray = items.filter((item) => item.kind === "group" && traySides.has(item.side as Side));
  const row = (members: readonly MapItem[], y: number) =>
    members.map((item, index) => [item.id, { x: (index - (members.length - 1) / 2) * (card.width + 140), y }] as const);
  return new Map([...row(main, 0), ...row(tray, card.height + 160)]);
};

export const mapPositions = (view: MapView, columns: number): Map<string, Point> => {
  const cards = view.mode === "cards";
  const parts = Array.from({ length: columns }, (_, column) => {
    const items = view.items.filter((item) => item.column === column);
    const ids = new Set(items.map((item) => item.id));
    const positions = layoutColumn(items, view.links.filter((link) => ids.has(link.from) && ids.has(link.to)), cards);
    const xs = [...positions.values()].map((point) => point.x);
    return { positions, minX: Math.min(0, ...xs), maxX: Math.max(0, ...xs) };
  });
  return parts.reduce(
    (state, part) => {
      const offset = state.cursor - part.minX;
      part.positions.forEach((point, id) => state.positions.set(id, { x: point.x + offset, y: point.y }));
      return { cursor: offset + part.maxX + fileBox.width + 240, positions: state.positions };
    },
    { cursor: 0, positions: new Map<string, Point>() },
  ).positions;
};

export const mapElements = (view: MapView, positions: ReadonlyMap<string, Point>): cytoscape.ElementDefinition[] => {
  const cards = view.mode === "cards";
  return [
    ...view.items.map((item) => ({
      group: "nodes" as const,
      classes: item.kind === "group" ? "card" : item.kind === "stub" ? "stub" : "mapfile",
      position: { ...(positions.get(item.id) ?? { x: 0, y: 0 }) },
      data: {
        id: item.id,
        label: itemLabel(item),
        side: item.side ?? "code",
        bucket: ccBucket(item.maxCC),
        entry: item.kind === "file" && item.entries > 0,
        cyclic: item.kind !== "stub" && item.cyclic,
      },
    })),
    ...view.links.map((link) => ({
      group: "edges" as const,
      classes: "map-edge",
      data: {
        id: link.id,
        source: link.from,
        target: link.to,
        width: cards ? Math.min(7, 1.4 + Math.log2(link.count) * 0.9) : 1.6,
        label: cards || link.from.startsWith("stub:") || link.to.startsWith("stub:") ? String(link.count) : "",
      },
    })),
  ];
};

const capZoom = (cy: cytoscape.Core, eles: cytoscape.CollectionArgument) => {
  if (cy.zoom() > comfortableZoom) {
    cy.zoom(comfortableZoom);
    cy.center(eles);
  }
};

export const fitVisible = (cy: cytoscape.Core) => {
  const visible = cy.elements().not(".hidden");
  cy.fit(visible, 40);
  capZoom(cy, visible);
};

const forceOptions = (count: number): cytoscape.LayoutOptions => ({
  name: "cose",
  animate: count <= 150,
  animationDuration: 400,
  padding: 30,
  randomize: true,
  nodeDimensionsIncludeLabels: true,
  componentSpacing: 80,
  idealEdgeLength: () => 70,
  nodeRepulsion: () => 9000,
});

export const runForceLayout = (cy: cytoscape.Core, layeredLayout = false) => {
  const visible = cy.elements().not(".hidden");
  const layout = visible.layout(
    layeredLayout
      ? { name: "breadthfirst", directed: true, spacingFactor: 1.15, padding: 30, animate: false }
      : forceOptions(visible.nodes().length),
  );
  layout.one("layoutstop", () => capZoom(cy, visible));
  layout.run();
};

export const restoreStructure = (cy: cytoscape.Core, data: GraphSnapshot) => {
  const positions = new Map(data.modules.map((module) => [module.id, module.position]));
  cy.batch(() => {
    cy.nodes(".file").positions((node) => ({ ...(positions.get(node.id()) ?? node.position()) }));
  });
};

export const sizeStructureLabels = (cy: cytoscape.Core) =>
  cy.batch(() => {
    cy.nodes(".lane").forEach((lane) => {
      lane.data("fontSize", Math.min(220, Math.max(30, lane.boundingBox({ includeLabels: false }).w / 10)));
    });
    cy.nodes(".group").forEach((group) => {
      const size = Math.min(20, Math.max(13, group.boundingBox({ includeLabels: false }).w / 18));
      group.data({ fontSize: size, labelOffset: size * 1.5 });
    });
  });

export const createGraph = (container: HTMLElement, items: cytoscape.ElementDefinition[], color: ColorMode) => {
  const large = items.length > largeGraph;
  return cytoscape({
    container,
    elements: items,
    style: graphStyle(color),
    layout: { name: "preset", fit: true, padding: 40 },
    minZoom: 0.02,
    maxZoom: 4,
    userZoomingEnabled: false,
    selectionType: "single",
    boxSelectionEnabled: false,
    textureOnViewport: large,
    hideEdgesOnViewport: large,
    motionBlur: false,
    pixelRatio: large ? 1 : "auto",
  });
};

export const emphasise = (cy: cytoscape.Core, id: string | null) =>
  cy.batch(() => {
    cy.elements().removeClass("dim outgoing incoming");
    if (!id) return;
    const element = cy.getElementById(id);
    if (element.empty()) return;
    const asEdge = element as unknown as cytoscape.EdgeSingular;
    const around = element.isNode() ? element.closedNeighborhood() : asEdge.union(asEdge.connectedNodes());
    cy.elements().not(around).addClass("dim");
    if (element.isNode()) {
      element.outgoers("edge").addClass("outgoing");
      element.incomers("edge").addClass("incoming");
    } else {
      asEdge.addClass("outgoing");
    }
  });

export const wheelZoom = (container: HTMLElement, current: () => cytoscape.Core | null) =>
  container.addEventListener(
    "wheel",
    (event) => {
      const cy = current();
      if (!cy) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? 800 : 1;
      const pixels = event.deltaY * unit * (event.ctrlKey ? 3 : 1);
      const clamped = Math.max(-300, Math.min(300, pixels));
      const level = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), cy.zoom() * Math.pow(2, -clamped / 160)));
      const bounds = container.getBoundingClientRect();
      cy.zoom({ level, renderedPosition: { x: event.clientX - bounds.left, y: event.clientY - bounds.top } });
    },
    { passive: false },
  );
