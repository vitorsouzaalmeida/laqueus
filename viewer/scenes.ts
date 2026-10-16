import type { FunctionNode, GraphSnapshot, ModuleNode } from "../src/model";
import type { FlowLink, FlowView } from "./flow";
import { basename } from "./dom";
import { card, ccBucket, itemLabel, stub } from "./graph";
import type { MapView } from "./map";
import type { EdgeData, Scene, SceneEdge, SceneNode } from "./scene";

const linkEdge = (data: Partial<EdgeData>): EdgeData => ({
  route: "link",
  width: 1.4,
  label: "",
  bend: 0,
  line: "solid",
  color: "var(--edge)",
  labelColor: "var(--muted)",
  ...data,
});

/** Bends one of each pair of opposite links so both stay visible. */
const bendFor = (pairs: ReadonlySet<string>, from: string, to: string, amount: number) =>
  from !== to && pairs.has(`${to}->${from}`) ? amount : 0;

export const mapScene = (view: MapView): Scene => {
  const cards = view.mode === "cards";
  const pairs = new Set(view.links.map((link) => `${link.from}->${link.to}`));
  return {
    nodes: view.items.map((item): SceneNode => {
      const shared = { label: itemLabel(item), side: item.side ?? "code", bucket: ccBucket(item.maxCC) };
      if (item.kind === "file") {
        const size = item.entries > 0 ? 30 : 24;
        return {
          id: item.id,
          parent: null,
          width: size,
          height: size,
          data: { kind: "dot", ...shared, cyclic: item.cyclic, entry: item.entries > 0, tint: "side", captionWidth: 170, fontSize: 11 },
        };
      }
      const box = item.kind === "group" ? card : stub;
      return {
        id: item.id,
        parent: null,
        ...box,
        data: { kind: item.kind === "group" ? "card" : "stub", ...shared, cyclic: item.kind === "group" && item.cyclic },
      };
    }),
    edges: view.links.map((link) => ({
      id: link.id,
      source: link.from,
      target: link.to,
      data: linkEdge({
        width: cards ? Math.min(7, 1.4 + Math.log2(link.count) * 0.9) : 1.6,
        label: cards || link.from.startsWith("stub:") || link.to.startsWith("stub:") ? String(link.count) : "",
        bend: bendFor(pairs, link.from, link.to, 40),
      }),
    })),
  };
};

const fileLabels = (modules: readonly ModuleNode[]) => {
  const counts = modules.reduce(
    (map, module) => map.set(basename(module.path), (map.get(basename(module.path)) ?? 0) + 1),
    new Map<string, number>(),
  );
  return (module: ModuleNode) =>
    (counts.get(basename(module.path)) ?? 0) > 1 ? module.path.split("/").slice(-2).join("/") : basename(module.path);
};

export const moduleScene = (data: GraphSnapshot): Scene => {
  const labelOf = fileLabels(data.modules);
  const cycleOf = new Map(data.modules.map((module) => [module.id, module.metrics.cycleGroup]));
  const laneCounts = data.modules.reduce(
    (map, module) => map.set(module.placement.side, (map.get(module.placement.side) ?? 0) + 1),
    new Map<string, number>(),
  );
  const pairs = new Set(data.dependencyEdges.map((edge) => `${edge.from}->${edge.to}`));
  const groupPairs = new Set(data.groupEdges.map((edge) => `${edge.from}->${edge.to}`));
  return {
    nodes: [
      ...data.lanes.map((lane): SceneNode => ({
        id: `lane:${lane.side}`,
        parent: null,
        width: 0,
        height: 0,
        data: { kind: "container", variant: "lane", label: `${lane.label} · ${laneCounts.get(lane.side) ?? 0} files`, padding: 40 },
      })),
      ...data.groups.map((group): SceneNode => ({
        id: group.id,
        parent: `lane:${group.side}`,
        width: 0,
        height: 0,
        data: {
          kind: "container",
          variant: "group",
          label: `${group.directory === "." ? "(project root)" : group.directory} · ${group.moduleIds.length}`,
          padding: 12,
        },
      })),
      ...data.modules.map((module): SceneNode => {
        const entry = module.placement.entry !== null;
        const size = entry ? 26 : 20;
        return {
          id: module.id,
          parent: module.groupId,
          width: size,
          height: size,
          data: {
            kind: "dot",
            label: `${labelOf(module)}\nCC ${module.metrics.maxCC ?? "N/A"} · in ${module.metrics.fanIn} · out ${module.metrics.fanOut}`,
            side: module.placement.side,
            bucket: ccBucket(module.metrics.maxCC),
            cyclic: module.metrics.cycleGroup !== null,
            entry,
            tint: "side",
            captionWidth: 160,
            fontSize: 10,
          },
        };
      }),
    ],
    edges: [
      ...data.groupEdges.map((edge) => ({
        id: `folders:${edge.from}->${edge.to}`,
        source: edge.from,
        target: edge.to,
        data: linkEdge({
          width: Math.min(5, 1 + Math.log2(edge.count) * 0.6),
          color: "var(--group-edge)",
          bend: bendFor(groupPairs, edge.from, edge.to, 40),
        }),
      })),
      ...data.dependencyEdges.map((edge) => {
        const from = cycleOf.get(edge.from) ?? null;
        const cyclic = from !== null && from === (cycleOf.get(edge.to) ?? null);
        return {
          id: `imports:${edge.from}->${edge.to}`,
          source: edge.from,
          target: edge.to,
          data: linkEdge({ color: cyclic ? "var(--cycle)" : "var(--edge)", bend: bendFor(pairs, edge.from, edge.to, 30) }),
        };
      }),
    ],
  };
};

export const structureCenters = (data: GraphSnapshot) => new Map(data.modules.map((module) => [module.id, { ...module.position }]));

export const functionScene = (
  functions: readonly FunctionNode[],
  callsFrom: (id: string) => readonly { from: string; to: string }[],
): Scene => {
  const calls = functions.flatMap((fn) => callsFrom(fn.id));
  const pairs = new Set(calls.map((edge) => `${edge.from}->${edge.to}`));
  return {
    nodes: functions.map((fn) => ({
      id: fn.id,
      parent: null,
      width: 20,
      height: 20,
      data: {
        kind: "dot",
        label: `${fn.name}\nCC ${fn.complexity}`,
        side: "code",
        bucket: ccBucket(fn.complexity),
        cyclic: false,
        entry: false,
        tint: "bucket",
        captionWidth: 160,
        fontSize: 10,
      },
    })),
    edges: calls.map((edge) => ({
      id: `calls:${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      data: linkEdge({ bend: bendFor(pairs, edge.from, edge.to, 30) }),
    })),
  };
};

const flowColors: Partial<Record<FlowLink["kind"], string>> = {
  true: "var(--edge-in)",
  false: "var(--flow-false)",
  case: "var(--decision-border)",
  exception: "var(--flow-throw)",
};

const flowEdge = (link: FlowLink): SceneEdge => {
  const color = flowColors[link.kind];
  return {
    id: link.id,
    source: link.from,
    target: link.to,
    data: linkEdge({
      route: link.kind === "back" ? "link" : "step",
      width: 1.6,
      label: link.label,
      bend: link.kind === "back" ? 70 : 0,
      line: link.kind === "exception" ? "dotted" : link.kind === "back" || link.kind === "break" ? "dashed" : "solid",
      color: color ?? "var(--edge)",
      labelColor: color ?? "var(--muted)",
    }),
  };
};

export const flowScene = (view: FlowView): Scene => ({
  nodes: view.items.map((item) => ({
    id: item.id,
    parent: null,
    width: item.width,
    height: item.height,
    data: { kind: "flow", flowKind: item.kind, label: item.label, unreachable: item.unreachable },
  })),
  edges: view.links.map(flowEdge),
});
