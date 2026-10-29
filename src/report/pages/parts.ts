import { type ModuleNode, byText, isStandaloneArea, isWidelyUsedArea } from "../../model";
import { type TreeNode, ancestry } from "../../scan/parts";
import { type ClassFacts, type FileFacts, type FunctionFacts, branchStep, holdsInside } from "../facts";
import { highFrom } from "../../language/complexity";
import { bullets, code, factLines, nested, orNone, page, plural, ratioText, section, subsection } from "../markdown";
import { widelyUsedText } from "../prose";
import type { Context } from "./context";
import { callList, chain, countedList, fanText, kindLabel, statsFacts, statsLine } from "./text";

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

export const partPages = (ctx: Context) => {
  const {
    facts,
    tree,
    options,
    add,
    names,
    node,
    inPart,
    pageOf,
    trail,
    partOf,
    partRef,
    cyclesTouching,
    packageLines,
    layerLines,
  } = ctx;

  const areaLines = (id: string): (readonly [string, string | number | null])[] => {
    const coupling = facts.areaFacts.get(id);

    return coupling
      ? [
          ["Touching imports", coupling.touching],
          ["Cohesion", ratioText(coupling.cohesion)],
          ["Instability", ratioText(coupling.instability)],
          ["Imports from other areas", coupling.incoming],
          ["Imports to other areas", coupling.outgoing],
        ]
      : [];
  };

  const description = (part: TreeNode) => {
    switch (part.kind) {
      case "root":
        return "The whole project.";
      case "side":
        return facts.sides.find((info) => info.side === part.side)?.description ?? "";
      case "folder":
        return "Files in this folder. Small subfolders are merged into their parent.";
      default:
        if (part.area && isWidelyUsedArea(part.area.id)) return widelyUsedText;

        return part.area && isStandaloneArea(part.area.id)
          ? "Files that import no other file of this side, apart from widely used files, and are imported by none."
          : "Files that mostly import each other, grouped by the Louvain method within this side and named after the folder that holds most of them.";
    }
  };

  const about = (part: TreeNode) =>
    [
      factLines([
        ["Part", names.get(part.id) ?? ""],
        ["Kind", kindLabel[part.kind]],
        ...(part.side === null ? [] : ([["Side", part.side]] as const)),
      ]),
      statsFacts(facts.stats(part.moduleIds)),
      ...(part.area ? [factLines(areaLines(part.area.id))] : []),
      description(part),
    ].join("\n\n");

  const indexPage = (part: TreeNode) => {
    const children = part.children.flatMap((id) => node(id) ?? []);
    const childOf = new Map(children.flatMap((child) => child.moduleIds.map((id) => [id, child.label] as const)));
    const steps = ancestry(tree, part.id);
    const crossings = facts.crossings(part.moduleIds, (id) =>
      branchStep(steps, [...(tree.pathOf.get(id) ?? ["root"]), id]),
    );
    const layers = part.kind === "side" ? facts.layers.find((entry) => entry.side === part.side) : undefined;

    return page(
      `${trail(part.id)}: ${statsLine(facts.stats(part.moduleIds))}`,
      trail(part.id),
      about(part),
      section(
        "Parts",
        bullets(children.map((child) => `${partRef(child.id)}: ${statsLine(facts.stats(child.moduleIds))}`)),
      ),
      section(
        "Imports between parts",
        bullets(
          facts
            .links(childOf)
            .map((link) => `${code(link.from)} → ${code(link.to)}: ${plural(link.imports, "import")}`),
        ),
      ),
      ...(layers ? [section("Layers", layerLines(layers, 10))] : []),
      section(
        "Imports with the rest of the project",
        bullets(
          crossings.map(
            (crossing) => `${partRef(crossing.key)}: ${crossing.outgoing} out to it, ${crossing.incoming} in from it`,
          ),
        ),
      ),
      section("Packages", packageLines(part.moduleIds)),
      section("Cycles", cyclesTouching(part.moduleIds, kindLabel[part.kind])),
    );
  };

  const fileSection = (module: ModuleNode) => {
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
                    warnings.map((warning) => `line ${orNone(warning.line)}, ${warning.kind}: ${warning.message}`),
                  )}`,
                ],
              ] as const)),
        ]),
      ),
      ...notable.map((fn) => functionSection(fn, options.logic)),
      ...classes.map(classSection),
    ].join("\n\n");
  };

  const leafPage = (part: TreeNode) => {
    const crossings = facts.crossings(part.moduleIds, partOf).toSorted((a, b) => byText(pageOf(a.key), pageOf(b.key)));
    const members = part.moduleIds
      .flatMap((id) => facts.modules.get(id) ?? [])
      .toSorted((a, b) => byText(a.path, b.path));

    return page(
      `${trail(part.id)}: ${statsLine(facts.stats(part.moduleIds))}`,
      trail(part.id),
      about(part),
      section(
        "Depends on",
        bullets(
          crossings
            .filter((crossing) => crossing.outgoing > 0)
            .map((crossing) => `${partRef(crossing.key)}: ${plural(crossing.outgoing, "import")}`),
        ),
      ),
      section(
        "Used by",
        bullets(
          crossings
            .filter((crossing) => crossing.incoming > 0)
            .map((crossing) => `${partRef(crossing.key)}: ${plural(crossing.incoming, "import")}`),
        ),
      ),
      section("Packages", packageLines(part.moduleIds)),
      section("Cycles", cyclesTouching(part.moduleIds, kindLabel[part.kind])),
      section("Files", members.map(fileSection).join("\n\n")),
    );
  };

  tree.nodes.forEach((part) => {
    if (part.kind === "root" || !inPart(part.id)) return;

    add(pageOf(part.id), part.children.length > 0 ? indexPage(part) : leafPage(part));
  });
};
