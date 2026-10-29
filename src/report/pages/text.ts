import { excessFrom, highFrom } from "../../language/complexity";
import { largestCut } from "../../graph/cycles";
import type { Side } from "../../model";
import type { BandShares, CycleEdge, CycleFacts, FunctionFacts, ImportRef, Rank, Stats } from "../facts";
import { code, factLines, nested, orNone, percent, plural } from "../markdown";

export const kindLabel = {
  root: "project",
  side: "side",
  area: "area",
  subarea: "sub-area",
  folder: "folder",
} as const;

export const statsLine = (stats: Stats) =>
  [
    plural(stats.files, "file"),
    plural(stats.entryPoints, "entry point"),
    plural(stats.functions, "function"),
    plural(stats.decisions, "decision"),
    `excess CC ${stats.excessCC}`,
    `max CC ${orNone(stats.maxCC)}`,
    `${stats.filesInCycles} in cycles`,
    `imports ${stats.imports.internal} internal, ${stats.imports.incoming} in, ${stats.imports.outgoing} out`,
  ].join(" · ");

export const statsFacts = (stats: Stats) =>
  factLines([
    ["Files", stats.files],
    ["Entry points", stats.entryPoints],
    ["Functions", stats.functions],
    ["Decisions", stats.decisions],
    ["Excess CC", stats.excessCC],
    ["Max CC", stats.maxCC],
    ["Files in cycles", stats.filesInCycles],
    ["Imports internal", stats.imports.internal],
    ["Imports in", stats.imports.incoming],
    ["Imports out", stats.imports.outgoing],
  ]);

export const lineList = (values: readonly number[]) => `line${values.length === 1 ? "" : "s"} ${values.join(", ")}`;

export const chain = (paths: readonly string[] | null) => (paths ? paths.map(code).join(" → ") : "no");

export const callList = (refs: FunctionFacts["calls"]) =>
  refs.length === 0 ? "none" : refs.map((ref) => `${code(ref.name)} (${lineList(ref.lines)})`).join(", ");

export const importNote = (ref: ImportRef) =>
  [
    lineList(ref.lines),
    ...(ref.via.length === 0 ? [] : [`via ${ref.via.map(code).join(", ")}`]),
    ...(ref.typeOnly ? ["types only"] : []),
  ].join(", ");

export const countedList = (refs: readonly ImportRef[]) =>
  refs.length === 0 ? "none" : `${refs.length}\n${nested(refs.map((ref) => `${code(ref.path)} (${importNote(ref)})`))}`;

export const edgeText = (edge: CycleEdge) =>
  `${code(edge.from)} → ${code(edge.to)} (${lineList(edge.lines)}: ${edge.names.map(code).join(", ")}${edge.typeOnly ? ", types only" : ""})`;

export const cutText = (cut: readonly CycleEdge[]) => cut.map(edgeText).join("; ");

export const ccText = (fn: FunctionFacts) => `CC ${fn.cc} (branches ${fn.branches})`;

export const rankText = (rank: Rank, side: Side, reason: string) =>
  rank === null
    ? `not ranked: ${reason}`
    : `${rank.band}, P${rank.percentile} of ${plural(rank.population, `ranked ${side} file`)}`;

export const severityText = (cycle: CycleFacts) =>
  `${cycle.severity.severity}: ${plural(cycle.files.length, "file")}, ${plural(cycle.severity.loops, "loop")}, ${
    cycle.cuts[0] ? `${plural(cycle.cuts[0].length, "import")} to cut` : "no cut found"
  }`;

export const searchText = (cycle: CycleFacts) =>
  cycle.search === "all"
    ? `every choice of up to ${plural(largestCut, "import")} was tried`
    : cycle.search === "exact"
      ? "fewest imports found by an exact search"
      : "found by a heuristic, may not be the fewest";

export const typesText = (cycle: CycleFacts) =>
  cycle.withoutTypes === 0
    ? "no cycle: it exists only because of type imports"
    : cycle.withoutTypes === cycle.files.length
      ? "the same cycle"
      : `${plural(cycle.withoutTypes, "file")} still in a cycle`;

export const shareText = (part: number, whole: number, noun: string, many = `${noun}s`) =>
  whole === 0 ? `none (no ${many})` : `${percent(part, whole)} (${part} of ${plural(whole, noun, many)})`;

export const bandRange = {
  low: `1–${excessFrom}`,
  moderate: `${excessFrom + 1}–${highFrom - 1}`,
  high: `${highFrom}+`,
};

export const bandLines = (label: string, shares: BandShares, noun: string, many: string) =>
  (["low", "moderate", "high"] as const).map(
    (band) =>
      [`${label}, ${band} band (${bandRange[band]})`, shareText(shares[band], shares.total, noun, many)] as const,
  );

export const fanText = (count: number, rank: Rank, side: Side, reason: string) =>
  `${count} (${rankText(rank, side, reason)})`;

export const more = (count: number, shown: number, where: string) =>
  count > shown ? `\n- And ${count - shown} more ${where}.` : "";
