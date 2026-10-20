import type { FunctionLogic, LogicEdgeKind, LogicNode, LogicNodeKind, Point } from "../src/model";
import { layered } from "./layered";

export type FlowItem = {
  id: string;
  kind: LogicNodeKind | "collapsed";
  label: string;
  node: LogicNode | null;
  hidden: number;
  unreachable: boolean;
  width: number;
  height: number;
};

export type FlowLink = { id: string; from: string; to: string; label: string; kind: LogicEdgeKind };

export type FlowView = { items: FlowItem[]; links: FlowLink[] };

export const structuralKinds: ReadonlySet<LogicNodeKind> = new Set(["decision", "loop", "switch", "try"]);

const largeFlow = 60;
const charWidth = 6.8;
const lineHeight = 15;

export const defaultCollapsed = (logic: FunctionLogic): Set<string> =>
  logic.nodes.length <= largeFlow
    ? new Set()
    : new Set(
        logic.nodes.filter((node) => structuralKinds.has(node.kind) && node.region !== null).map((node) => node.id),
      );

export const regionChain = (logic: FunctionLogic, id: string): string[] => {
  const byId = new Map(logic.nodes.map((node) => [node.id, node]));
  const walk = (region: string | null): string[] =>
    region === null ? [] : [region, ...walk(byId.get(region)?.region ?? null)];

  return walk(byId.get(id)?.region ?? null);
};

export const wrap = (text: string, width: number): string[] =>
  text.split("\n").flatMap((line) =>
    line.length <= width
      ? [line]
      : line.split(" ").reduce<string[]>((lines, word) => {
          const last = lines[lines.length - 1];
          return last !== undefined && `${last} ${word}`.length <= width
            ? [...lines.slice(0, -1), `${last} ${word}`]
            : [...lines, word];
        }, []),
  );

const sizeOf = (kind: FlowItem["kind"], lines: readonly string[]) => {
  const longest = Math.max(4, ...lines.map((line) => line.length));
  const width = Math.min(380, Math.max(110, longest * charWidth + 28));
  const height = lines.length * lineHeight + 22;

  return kind === "decision" || kind === "switch"
    ? { width: width * 1.35 + 20, height: height * 1.7 + 12 }
    : kind === "loop"
      ? { width: width + 40, height: height + 8 }
      : { width, height };
};

const labelFor = (node: LogicNode) => {
  const width = node.kind === "block" ? 52 : 40;
  const base = wrap(node.label, width);
  const extras = [node.weight > 0 ? `CC +${node.weight}` : null, node.unreachable ? "(unreachable)" : null].filter(
    (line): line is string => line !== null,
  );

  return [...base, ...extras];
};

export const flowView = (logic: FunctionLogic, collapsed: ReadonlySet<string>): FlowView => {
  const chains = new Map(logic.nodes.map((node) => [node.id, regionChain(logic, node.id)]));
  const representative = (id: string) => {
    const hiddenBy = (chains.get(id) ?? []).toReversed().find((region) => collapsed.has(region));
    return hiddenBy ? `collapsed:${hiddenBy}` : id;
  };

  const visible = logic.nodes.filter((node) => representative(node.id) === node.id);
  const placeholders = [...collapsed]
    .filter((id) => logic.nodes.some((node) => node.id === id) && representative(id) === id)
    .map((id) => {
      const hidden = logic.nodes.filter((node) => representative(node.id) === `collapsed:${id}`).length;
      const lines = [`… ${hidden} step${hidden === 1 ? "" : "s"} inside`, "double-click to expand"];

      return {
        id: `collapsed:${id}`,
        kind: "collapsed" as const,
        label: lines.join("\n"),
        node: null,
        hidden,
        unreachable: false,
        ...sizeOf("collapsed", lines),
      };
    })
    .filter((item) => item.hidden > 0);
  const items: FlowItem[] = [
    ...visible.map((node) => {
      const lines = labelFor(node);
      return {
        id: node.id,
        kind: node.kind,
        label: lines.join("\n"),
        node,
        hidden: 0,
        unreachable: node.unreachable,
        ...sizeOf(node.kind, lines),
      };
    }),
    ...placeholders,
  ];

  const known = new Set(items.map((item) => item.id));
  const links = logic.edges
    .map((edge) => ({ ...edge, from: representative(edge.from), to: representative(edge.to) }))
    .filter((edge) => edge.from !== edge.to && known.has(edge.from) && known.has(edge.to))
    .reduce((map, edge) => {
      const key = `${edge.from}->${edge.to}`;
      const existing = map.get(key);
      const label =
        existing && existing.label !== edge.label
          ? [existing.label, edge.label].filter(Boolean).join(" / ")
          : edge.label;

      return map.set(key, {
        id: `flow:${key}`,
        from: edge.from,
        to: edge.to,
        label,
        kind: existing?.kind ?? edge.kind,
      });
    }, new Map<string, FlowLink>());

  return { items, links: [...links.values()] };
};

export const flowPositions = (view: FlowView): Map<string, Point> =>
  layered(
    view.items.map((item) => ({
      id: item.id,
      width: item.width,
      height: item.height,
      rank: item.kind === "start" ? ("top" as const) : undefined,
    })),
    view.links.filter((link) => link.kind !== "back").map((link) => ({ from: link.from, to: link.to })),
    { maxPerRow: 4, gapX: 46, gapY: 64 },
  );
