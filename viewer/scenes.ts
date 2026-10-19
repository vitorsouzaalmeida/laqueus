import type { FunctionNode } from "../src/model";
import type { FlowLink, FlowView } from "./flow";
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
          width: size,
          height: size,
          data: { kind: "dot", ...shared, cyclic: item.cyclic, entry: item.entries > 0, tint: "side", captionWidth: 170, fontSize: 11 },
        };
      }
      const box = item.kind === "group" ? card : stub;
      return {
        id: item.id,
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

export const functionScene = (
  functions: readonly FunctionNode[],
  callsFrom: (id: string) => readonly { from: string; to: string }[],
): Scene => {
  const calls = functions.flatMap((fn) => callsFrom(fn.id));
  const pairs = new Set(calls.map((edge) => `${edge.from}->${edge.to}`));
  return {
    nodes: functions.map((fn) => ({
      id: fn.id,
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
    width: item.width,
    height: item.height,
    data: { kind: "flow", flowKind: item.kind, label: item.label, unreachable: item.unreachable },
  })),
  edges: view.links.map(flowEdge),
});
