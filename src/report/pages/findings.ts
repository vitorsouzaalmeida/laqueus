import { byText } from "../../model";
import { findings, pairsOf, shownHigh, shownTop } from "../findings";
import { bullets, code, factLines, orNone, page, plural, section, subsection } from "../markdown";
import type { Context } from "./context";
import { bandLines, ccText, cutText, more, severityText, shareText } from "./text";

export const findingsPage = (ctx: Context) => {
  const {
    facts,
    add,
    modules,
    sideLabel,
    inPart,
    pageOf,
    partRef,
    filePageOf,
    areaName,
    cycles,
    scopeSides,
    touchesArea,
    layerSides,
    tree,
  } = ctx;
  const { high, heldInside, bigClasses, excess, through, findingCycles, barrels } = findings(facts, modules, cycles);
  const leafParts = [...tree.nodes.values()]
    .filter((part) => part.kind !== "root" && part.children.length === 0 && inPart(part.id))
    .map((part) => ({ part, stats: facts.stats(part.moduleIds) }))
    .filter((entry) => entry.stats.excessCC > 0)
    .toSorted((a, b) => b.stats.excessCC - a.stats.excessCC || byText(pageOf(a.part.id), pageOf(b.part.id)));
  add(
    "_findings.md",
    page(
      `Findings: ${plural(high.length, "function")} in the high CC band · ${plural(heldInside.length, "function")} holding logic in inner functions · ${plural(findingCycles.length, "cycle")}`,
      "Findings",
      "What stands out in this export. Each line points to the page with the details; what each label counts is in `_definitions.md`. The health of each side as a whole is in `_health.md`.",
      section(
        "Complexity by side",
        facts.complexity
          .filter((entry) => scopeSides.has(entry.side))
          .map((entry) =>
            subsection(
              `${sideLabel(entry.side)} (${entry.side})`,
              factLines([
                ["Functions", entry.functions],
                ["Decisions", entry.conditions.total],
                ...(entry.conditions.total === 0
                  ? []
                  : [
                      ...bandLines("CC", entry.conditions, "decision", "decisions"),
                      ...bandLines("Branches only", entry.branches, "branch", "branches"),
                    ]),
              ]),
            ),
          )
          .join("\n\n") || "none",
      ),
      section(
        "Parts with the most excess CC",
        `${bullets(
          leafParts
            .slice(0, shownTop)
            .map(
              ({ part, stats }) =>
                `${partRef(part.id)}: excess CC ${stats.excessCC}, ${plural(stats.decisions, "decision")}, ${plural(stats.files, "file")}`,
            ),
        )}${more(leafParts.length, shownTop, "parts with excess CC")}`,
      ),
      section(
        "Files with the most excess CC",
        `${bullets(
          excess
            .slice(0, shownTop)
            .map(
              (module) =>
                `${code(module.path)} (${filePageOf(module.path)}): excess CC ${module.metrics.excessCC}, ${plural(module.metrics.decisions, "decision")}, max CC ${orNone(module.metrics.maxCC)}`,
            ),
        )}${more(excess.length, shownTop, "files with excess CC")}`,
      ),
      section(
        "Functions in the high CC band",
        `${bullets(
          high.slice(0, shownHigh).map((fn) => `${code(fn.name)} in ${code(fn.file)} line ${fn.line}: ${ccText(fn)}`),
        )}${more(high.length, shownHigh, "in the high band")}`,
      ),
      section(
        "Logic held in inner functions",
        `${bullets([
          ...heldInside
            .slice(0, shownTop)
            .map(
              (fn) =>
                `${code(fn.name)} in ${code(fn.file)} line ${fn.line}: inclusive CC ${fn.inclusive}, own CC ${fn.cc}${
                  fn.outerWrites === 0 ? "" : `, ${plural(fn.outerWrites, "outer variable")} written by inner functions`
                }`,
            ),
          ...bigClasses
            .slice(0, shownTop)
            .map(
              (cls) => `class ${code(cls.name)} in ${code(cls.file)} line ${cls.line}: inclusive CC ${cls.inclusive}`,
            ),
        ])}${more(heldInside.length, shownTop, "functions")}${more(bigClasses.length, shownTop, "classes")}`,
      ),
      section(
        "Files most changes pass through",
        `${bullets(
          through.slice(0, shownTop).map((module) => {
            const file = facts.file(module);
            return `${code(module.path)} (${module.placement.side}, ${file.role}): ${pairsOf(module)} file pairs (${module.metrics.visibilityFanIn} × ${module.metrics.visibilityFanOut}); fan-in ${module.metrics.fanIn}, fan-out ${module.metrics.fanOut}${file.cycle === null ? "" : `, cycle #${file.cycle}`}`;
          }),
        )}${more(through.length, shownTop, "files")}`,
      ),
      section(
        "Import cycles",
        `${bullets(
          findingCycles.map(
            (cycle) =>
              `Cycle #${cycle.number}, ${severityText(cycle)}; ${cycle.reach.pairs} file pairs pass through it${
                cycle.withoutTypes === 0 ? "; it exists only because of type imports" : ""
              }. Cut: ${cycle.cuts[0] ? cutText(cycle.cuts[0]) : "none found"}`,
          ),
        )}\n\nEvery choice and the imports of each cycle: \`_cycles.md\`.`,
      ),
      section(
        "Layers",
        `${bullets(
          layerSides.map(
            (layers) =>
              `${layers.side}: ${shareText(layers.back.length, layers.between, "import between areas", "imports between areas")} point back${layers.approximate ? " (approximate)" : ""}`,
          ),
        )}\n\n${subsection(
          "Two-way dependencies",
          bullets(
            facts.twoWay
              .filter((pair) => touchesArea(pair.a, pair.b))
              .slice(0, 10)
              .map(
                (pair) => `${pair.side}: ${areaName(pair.a)} and ${areaName(pair.b)}: ${pair.ab} → and ${pair.ba} ←`,
              ),
          ),
        )}\n\nDetails: \`_areas.md\`.`,
      ),
      section(
        "Barrels",
        `${factLines([["Barrels", barrels.length]])}${barrels.length === 0 ? "" : `\n${bullets(barrels.map(code))}`}`,
      ),
    ),
  );
};
