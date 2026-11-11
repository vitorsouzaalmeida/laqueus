import type { ModuleNode } from "../../model";
import { highFrom } from "../../language/complexity";
import { type ClassFacts, type Facts, type FileFacts, type FunctionFacts, holdsInside } from "../facts";
import { code, factLines, nested, oneLine, orNone, subsection } from "../markdown";
import { callList, chain, countedList, fanText } from "./text";

const functionSection = (fn: FunctionFacts, logic: boolean) => {
  const decisions = [
    `- Decisions: ${fn.cc === 1 ? "none" : fn.cc - 1}`,
    logic
      ? nested(
          fn.decisions.map(
            (decision) => `line ${decision.line} (+${decision.weight}, ${decision.kind}): ${code(decision.label)}`,
          ),
        )
      : "",
    `- Ways out: ${logic ? fn.waysOut : "not included in this export"}`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return `#### ${code(fn.name)} (line ${fn.line})\n\n${[
    `- CC: ${fn.cc}`,
    `- Branches: ${fn.branches}`,
    `- CC band: ${fn.ccBand}`,
    ...(fn.inclusive === fn.cc ? [] : [`- Inclusive CC: ${fn.inclusive}`]),
    ...(fn.outerWrites === 0 ? [] : [`- Outer variables written by inner functions: ${fn.outerWrites}`]),
    decisions,
    `- Calls: ${callList(fn.calls)}`,
    `- Called by: ${callList(fn.calledBy)}`,
  ].join("\n")}`;
};

const classSection = (cls: ClassFacts) =>
  `#### class ${code(cls.name)} (line ${cls.line})\n\n- Inclusive CC: ${cls.inclusive}`;

export const fileSection = (
  facts: Facts,
  module: ModuleNode,
  logic: boolean,
  lead: readonly (readonly [string, string | number | null])[] = [],
) => {
  const file: FileFacts = facts.file(module);
  const { metrics, placement } = module;
  const functions = facts.functionsOf(module.id);
  const notable = functions.filter((fn) => fn.ccBand !== "low" || holdsInside(fn));
  const classes = facts.classesOf(module.id).filter((cls) => cls.inclusive >= highFrom);
  const cycle = facts.cycles.find((candidate) => candidate.number === file.cycle);
  const warnings = facts.diagnostics.filter((diagnostic) => diagnostic.file === module.path);

  return [
    subsection(
      code(module.path),
      factLines([
        ...lead,
        ["Entry point", placement.entry],
        ...(facts.project.framework === null
          ? []
          : ([
              ["Reached on the client", chain(placement.chains.client ?? null)],
              ["Reached on the server", chain(placement.chains.server ?? null)],
            ] as const)),
        ["Barrel", module.barrel ? "yes" : "no"],
        ["Fan-in", fanText(metrics.fanIn, file.fanInRank, placement.side, module.barrel ? "barrel" : "entry point")],
        ["Fan-out", fanText(metrics.fanOut, file.fanOutRank, placement.side, "barrel")],
        ["Visibility fan-in", metrics.visibilityFanIn],
        ["Visibility fan-out", metrics.visibilityFanOut],
        ["Role", file.role],
        ["Functions", metrics.functionCount],
        ["Functions above CC 10", notable.filter((fn) => fn.ccBand !== "low").length],
        ["Decisions", metrics.decisions],
        ["Excess CC", metrics.excessCC],
        ["Max CC", metrics.maxCC === null ? null : `${metrics.maxCC} (${file.maxCcBand ?? "none"})`],
        [
          "Cycle",
          cycle
            ? `#${cycle.number} (${cycle.files
                .filter((other) => other !== module.path)
                .map(code)
                .join(", ")})`
            : null,
        ],
        ["Packages", module.externals.length === 0 ? null : module.externals.map(code).join(", ")],
        ["Imports", countedList(file.imports)],
        ["Imported by", countedList(file.importedBy)],
        ...(warnings.length === 0
          ? []
          : ([
              [
                "Warnings",
                `${warnings.length}\n${nested(
                  warnings.map(
                    (warning) => `line ${orNone(warning.line)}, ${warning.kind}: ${oneLine(warning.message)}`,
                  ),
                )}`,
              ],
            ] as const)),
      ]),
    ),
    ...notable.map((fn) => functionSection(fn, logic)),
    ...classes.map(classSection),
  ].join("\n\n");
};
