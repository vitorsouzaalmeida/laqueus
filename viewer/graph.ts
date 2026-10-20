import type { Point, Side } from "../src/model";
import { type LayoutNode, layered } from "./layered";
import type { MapItem, MapLink, MapView } from "./map";

export type FunctionLayout = "cose" | "breadthfirst";
export type ColorMode = "side" | "complexity";

export const ccBucket = (value: number | null) =>
  value === null ? 0 : value < 5 ? 1 : value < 10 ? 2 : value < 20 ? 3 : 4;

export const bucketLabels = ["no functions", "1–4", "5–9", "10–19", "20+"];

export const card = { width: 240, height: 96 };
export const stub = { width: 200, height: 60 };
const fileBox = { width: 180, height: 60 };

const itemSize = (item: MapItem) => (item.kind === "group" ? card : item.kind === "stub" ? stub : fileBox);

export const itemLabel = (item: MapItem) => {
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
  const inTray = (item: MapItem) => item.side !== null && traySides.has(item.side);
  const main = items.filter((item) => item.kind === "group" && !inTray(item));
  const tray = items.filter((item) => item.kind === "group" && inTray(item));
  const row = (members: readonly MapItem[], y: number) =>
    members.map((item, index) => [item.id, { x: (index - (members.length - 1) / 2) * (card.width + 140), y }] as const);

  return new Map([...row(main, 0), ...row(tray, card.height + 160)]);
};

export const mapPositions = (view: MapView, columns: number): Map<string, Point> => {
  const cards = view.mode === "cards";
  const parts = Array.from({ length: columns }, (_, column) => {
    const items = view.items.filter((item) => item.column === column);
    const ids = new Set(items.map((item) => item.id));
    const positions = layoutColumn(
      items,
      view.links.filter((link) => ids.has(link.from) && ids.has(link.to)),
      cards,
    );
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
