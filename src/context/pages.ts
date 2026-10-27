import { farOut, widelyUsedShare } from "../areas";
import {
  type BandShares,
  type ClassFacts,
  type CycleEdge,
  type CycleFacts,
  type Facts,
  type FileFacts,
  type FunctionFacts,
  type ImportRef,
  type Layers,
  type Rank,
  type Stats,
  branchStep,
  byText,
  holdsInside,
  shownCuts,
} from "../facts";
import { excessFrom, highFrom } from "../judgement";
import { exactLimit } from "../layers";
import { largestCut } from "../metrics";
import { type ModuleNode, type Result, type Side, err, isStandaloneArea, isWidelyUsedArea, ok } from "../model";
import { type Tree, type TreeNode, ancestry, partNames, slug } from "../tree";
import {
  bullets,
  code,
  factLines,
  nested,
  orNone,
  page,
  percent,
  plural,
  ratioText,
  section,
  subsection,
} from "./markdown";

export type Pages = Map<string, string>;

export type PageOptions = { exportedAt: string; scope?: string };

const kindLabel = { root: "project", side: "side", area: "area", subarea: "sub-area", folder: "folder" } as const;

const shownHigh = 50;
const shownTop = 20;

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

const statsFacts = (stats: Stats) =>
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

const lineList = (values: readonly number[]) => `line${values.length === 1 ? "" : "s"} ${values.join(", ")}`;

const chain = (paths: readonly string[] | null) => (paths ? paths.map(code).join(" → ") : "no");

const callList = (refs: FunctionFacts["calls"]) =>
  refs.length === 0 ? "none" : refs.map((ref) => `${code(ref.name)} (${lineList(ref.lines)})`).join(", ");

const importNote = (ref: ImportRef) =>
  [
    lineList(ref.lines),
    ...(ref.via.length === 0 ? [] : [`via ${ref.via.map(code).join(", ")}`]),
    ...(ref.typeOnly ? ["types only"] : []),
  ].join(", ");

const countedList = (refs: readonly ImportRef[]) =>
  refs.length === 0 ? "none" : `${refs.length}\n${nested(refs.map((ref) => `${code(ref.path)} (${importNote(ref)})`))}`;

const edgeText = (edge: CycleEdge) =>
  `${code(edge.from)} → ${code(edge.to)} (${lineList(edge.lines)}: ${edge.names.map(code).join(", ")}${edge.typeOnly ? ", types only" : ""})`;

const cutText = (cut: readonly CycleEdge[]) => cut.map(edgeText).join("; ");

const ccText = (fn: FunctionFacts) => `CC ${fn.cc} (branches ${fn.branches})`;

const rankText = (rank: Rank, side: Side, reason: string) =>
  rank === null
    ? `not ranked: ${reason}`
    : `${rank.band}, P${rank.percentile} of ${plural(rank.population, `ranked ${side} file`)}`;

const severityText = (cycle: CycleFacts) =>
  `${cycle.severity.severity}: ${plural(cycle.files.length, "file")}, ${plural(cycle.severity.loops, "loop")}, ${
    cycle.cuts[0] ? `${plural(cycle.cuts[0].length, "import")} to cut` : "no cut found"
  }`;

const searchText = (cycle: CycleFacts) =>
  cycle.search === "all"
    ? `every choice of up to ${plural(largestCut, "import")} was tried`
    : cycle.search === "exact"
      ? "fewest imports found by an exact search"
      : "found by a heuristic, may not be the fewest";

const typesText = (cycle: CycleFacts) =>
  cycle.withoutTypes === 0
    ? "no cycle: it exists only because of type imports"
    : cycle.withoutTypes === cycle.files.length
      ? "the same cycle"
      : `${plural(cycle.withoutTypes, "file")} still in a cycle`;

const shareText = (part: number, whole: number, noun: string, many = `${noun}s`) =>
  whole === 0 ? `none (no ${many})` : `${percent(part, whole)} (${part} of ${plural(whole, noun, many)})`;

const bandRange = { low: `1–${excessFrom}`, moderate: `${excessFrom + 1}–${highFrom - 1}`, high: `${highFrom}+` };

const bandLines = (label: string, shares: BandShares, noun: string, many: string) =>
  (["low", "moderate", "high"] as const).map(
    (band) =>
      [`${label}, ${band} band (${bandRange[band]})`, shareText(shares[band], shares.total, noun, many)] as const,
  );

const fanText = (count: number, rank: Rank, side: Side, reason: string) => `${count} (${rankText(rank, side, reason)})`;

const functionSection = (fn: FunctionFacts) => {
  const decisions = [
    `- Decisions: ${fn.cc === 1 ? "none" : fn.cc - 1}`,
    fn.logic
      ? nested(
          fn.logic.decisions.map(
            (decision) => `line ${decision.line} (+${decision.weight}, ${decision.kind}): ${code(decision.label)}`,
          ),
        )
      : "",
    `- Ways out: ${fn.logic ? fn.logic.waysOut : "not included in this export"}`,
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

const pairsOf = (module: ModuleNode) => module.metrics.visibilityFanIn * module.metrics.visibilityFanOut;

const more = (count: number, shown: number, where: string) =>
  count > shown ? `\n- And ${count - shown} more ${where}.` : "";

const widelyUsedText = `Files imported by at least ${widelyUsedShare * 100}% of the files of their side and far more than the rest: their fan-in is above the side's third quartile plus ${farOut} times the interquartile range, counted as at least 1 (Tukey's far-out values). They are set aside before the areas are found and kept together here, as Bunch does with omnipresent modules (https://doi.org/10.1109/ICSM.1999.792498), so imports of them do not pull areas together.`;

const definitions: readonly (readonly [string, string])[] = [
  [
    "Scope",
    "Test files are not scanned: names with .test., .spec. or .stories., and folders named test, tests, __tests__, __mocks__, __fixtures__ or e2e. Imports of test files are left out too.",
  ],
  [
    "Parts",
    "The project is split the way `laqueus list` splits it: by side, then by area and sub-area (client, shared, server and code sides) or by folder (the other sides). Every part has a page, named like the part: `server/_index.md` for the server side, `server/src-lib.md` for an area. A part with sub-parts has an `_index.md` in a folder of its name.",
  ],
  [
    "CC",
    `Cyclomatic complexity of one function: 1, plus 1 for each branch and each condition. Branches: if, loop (for, for-in, for-of, while, do-while), catch, ternary, case with a test, and in Svelte templates {#if}, {:else if}, {#each}, {#await} and {:catch}. Conditions: && and ||, and the logical assignments &&= and ||=. Checks for undefined values add nothing: optional chains (?.), ?? and ??=, and default values. Inner functions, classes and Svelte snippets are measured on their own.`,
  ],
  [
    "Branches",
    "CC counting branches only, without conditions, as Myers suggested in 1977: a function made of one long condition reads as one list of cases, not as a tangle of ifs. Written next to CC, as `CC 31 (branches 2)`. Bands, Max CC and excess CC use CC, not branches.",
  ],
  [
    "Inclusive CC",
    "1 plus the decisions of a function and of every function inside it. Shown only where it differs from CC. A class's inclusive CC is 1 plus the decisions of all its methods and field initialisers.",
  ],
  [
    "Outer variables written by inner functions",
    "Variables a function declares with let or var, or receives as parameters, that its inner functions assign to (=, compound assignment, ++, --, destructuring). State changed through an object's properties is not counted. A function with many of them is a class written as a function.",
  ],
  [
    "Function names",
    "Inner functions are prefixed with the function holding them: `load › db.transaction callback`, `build › format`. Other unnamed functions are `<anonymous>@<line>`. A Svelte component's markup is one function named `<template>`, a snippet is `<template> › name`, and an inline handler is named after its attribute, e.g. `<template> › onclick callback`. Names can repeat within a file; the line tells them apart.",
  ],
  ["Max CC", "Highest CC among the functions of a file, or of every file in a part. none when there is no function."],
  [
    "Decisions",
    "CC minus 1, summed over functions: the number of branch points. Each function's own decisions are counted once.",
  ],
  [
    "Excess CC",
    `max(0, CC − ${excessFrom}) summed over functions. Zero for code within McCabe's threshold of ${excessFrom}; it says how much branching sits above it. Unlike a mean, adding a trivial function does not change it.`,
  ],
  ["Ways out", "Points where a function can end: each return, each throw, and the end of its body."],
  [
    "Calls, Called by",
    "Calls between functions of the same file that the scan could resolve. Calls across files are not tracked.",
  ],
  [
    "Imports",
    "Local imports, counted once per importing file and imported file however many statements join them. Type-only imports count too, and are marked `types only`: when a type changes, every file that imports it must be checked. Sides use only the imports that run. A name imported through a file that re-exports it (export … from, export *, or import then export) counts against the file that declares it, and is listed with `via` and the files it passed through. A whole-module import (import * as, import(), side-effect import) stays on the file it names.",
  ],
  ["Fan-in", "Number of distinct files that import this file, not counting itself."],
  ["Fan-out", "Number of distinct files this file imports, not counting itself."],
  [
    "Barrel",
    "A file that only re-exports names from other files, with no code of its own. Barrels are not ranked by fan-in or fan-out. Sides follow imports as written, so a barrel still places what it re-exports, as SvelteKit loads all of it.",
  ],
  [
    "Visibility fan-in, Visibility fan-out",
    "How many files reach this one through imports, directly or through others, and how many it reaches; the file itself is counted. Measured on all files with value and type imports (MacCormack, Rusnak and Baldwin, 2006).",
  ],
  [
    "Role",
    "Visibility fan-in and fan-out compared with the medians of the file's side; high means strictly above the median. Central: both high. Shared: many depend on it, it depends on little. Control: it depends on much, few depend on it. Peripheral: both low (Baldwin, MacCormack and Rusnak, 2014).",
  ],
  [
    "File pairs passing through",
    "Visibility fan-in × visibility fan-out: the number of pairs of files whose dependency can pass through this file or cycle.",
  ],
  [
    "Imports internal, Imports in, Imports out",
    "Imports with both files inside the part, from a file outside to one inside, and from a file inside to one outside.",
  ],
  [
    "Cycle",
    "Two or more files that import each other in a loop, found as strongly connected components. A file that imports itself is not a cycle; outside a Svelte component it is reported as a warning. Cycles are numbered from 1 in the order of their first file path.",
  ],
  [
    "Cycle severity",
    "Size of the cycle: minor (2 files), moderate (3–5), severe (6+). Each file of a cycle reaches all the others.",
  ],
  [
    "Loops",
    "Independent loops of a cycle: imports inside it − files + 1. A ring has 1, and each extra import adds one.",
  ],
  [
    "Smallest cut",
    `The fewest imports inside a cycle whose removal leaves no cycle among its files. Every choice of up to ${largestCut} imports is listed, fewest imported names first, at most ${shownCuts}. When none is that small, one cut is searched: exactly for up to ${exactLimit} files, otherwise with the Eades–Lin–Smyth heuristic, putting back every removed import that does not recreate a cycle.`,
  ],
  ["Without type imports", "How many of a cycle's files are still in a cycle when only the imports that run are kept."],
  [
    "Side",
    "Where a file runs, found by walking imports that run from the SvelteKit entry points. The sides are listed in _index.md.",
  ],
  [
    "Area, Sub-area",
    "Groups of files of one side found with the Louvain method on the imports between them, stopped after two levels. Files in the same folder get a weak extra link: in a folder of k files each pair gets 1/(k − 1), so every file's folder links add up to 1, the weight of one import. Each area is named after the folder most of its files live in. Internal imports: both files in the area. Touching imports: at least one file in the area and the other in an area of the same side.",
  ],
  ["Widely used files", widelyUsedText],
  [
    "Cohesion",
    "Internal imports divided by touching imports, from 0 to 1. Higher means the area mostly imports itself.",
  ],
  [
    "Instability",
    "Imports from the area to other areas of its side divided by all imports between it and them (in + out), from 0 to 1. 0: others depend on it and it depends on none. 1: it depends on others and none depend on it.",
  ],
  [
    "Layer order",
    `The order of a side's areas with the fewest imports pointing back, from the areas that import the others to the areas they build on. An import points back when it goes from an area to one earlier in the order. Found exactly for up to ${exactLimit} areas, with the Eades–Lin–Smyth heuristic above; ties are broken by the fewest imported names, then by name.`,
  ],
  ["Two-way dependency", "Two areas of the same side that import each other, with the imports each way."],
  [
    "Entry point",
    "A file SvelteKit loads itself (pages, layouts, endpoints, hooks…), or, outside a SvelteKit app, a file no other file imports.",
  ],
  [
    "Reached on the client, Reached on the server",
    "Shortest import chain from an entry point to the file on that side. no when the file is not reached from that side.",
  ],
  [
    "Packages",
    "External packages a file imports. For a part: each package with the number of its files that import it.",
  ],
  [
    "CC band",
    `Fixed thresholds on cyclomatic complexity: low (1–${excessFrom}), moderate (${excessFrom + 1}–${highFrom - 1}), high (${highFrom}+). These do not change with project size.`,
  ],
  [
    "Fan-in band, Fan-out band",
    "Percentile rank of a file's fan-in or fan-out among the ranked files of its side: floor(100 × ranked files with a strictly lower value / ranked files). Bands: low (below P75), moderate (P75–P89), high (P90–P94), extreme (P95+). Entry points are not ranked by fan-in, since nothing imports them, and barrels are not ranked at all.",
  ],
  [
    "Share of decisions in a band",
    `The decisions of the functions in a CC band, as a share of all decisions of the side. Given twice: counting conditions (CC) and branches only, each function placed in the band of that count.`,
  ],
  ["Lines", "Lines are 1-based."],
];

const healthNotes: readonly (readonly [string, string])[] = [
  [
    "Propagation cost",
    "The mean share of the side's files that one file reaches through imports between the side's own files, itself included (MacCormack, Rusnak and Baldwin, 2006). It is the average share of files a change can reach. In that paper, Mozilla went from 17.35% to 2.78% after its redesign. The lowest possible value is 1 divided by the number of files, so compare only sides of similar size.",
  ],
  [
    "Largest cycle",
    "The files of the largest import cycle as a share of the side. A small share means the code is mostly layered.",
  ],
  [
    "Imports pointing back",
    "The share of imports between the side's areas that go against the best layer order (see Layer order in `_definitions.md`). 0% is perfectly layered.",
  ],
  [
    "Complex decisions",
    `The share of the side's decisions that sit in functions above CC ${excessFrom}, counting conditions and counting branches only.`,
  ],
  [
    "Modularity",
    "Computed on the imports between the side's files, for the areas and for the files grouped by their own folder (Newman and Girvan, 2004). Folders are a fixed grouping, so above about 0.3 means they follow the dependencies. Areas are chosen to maximise modularity, which finds high values even in random graphs (Guimerà, Sales-Pardo and Amaral, 2004), so read the areas' value against the folders', not against 0.3.",
  ],
];

export const buildPages = (facts: Facts, tree: Tree, options: PageOptions): Result<Pages> => {
  const { data } = facts;
  const scopeNode = options.scope === undefined ? undefined : tree.nodes.get(options.scope);

  if (options.scope !== undefined && !scopeNode) return err(`Unknown part: ${options.scope}`);

  const included = scopeNode ? new Set(scopeNode.moduleIds) : null;
  const modules = included ? data.modules.filter((module) => included.has(module.id)) : data.modules;
  const includedPaths = new Set(modules.map((module) => module.path));
  const touches = (paths: readonly string[]) => paths.some((path) => includedPaths.has(path));
  const names = partNames(tree);
  const pages: Pages = new Map();
  const collisions: string[] = [];
  const add = (path: string, content: string) => {
    if (pages.has(path)) collisions.push(path);
    pages.set(path, content);
  };

  const laneLabel = new Map(data.lanes.map((lane) => [lane.side, lane.label]));
  const sideLabel = (side: Side) => laneLabel.get(side) ?? side;
  const node = (id: string) => tree.nodes.get(id);
  const inPart = (id: string) => !scopeNode || ancestry(tree, id).includes(scopeNode.id);
  const pageOf = (id: string) => {
    const found = node(id);
    const name = names.get(id) ?? "";

    if (!found || found.kind === "root") return "_index.md";

    return found.children.length > 0 ? `${name}/_index.md` : `${name}.md`;
  };
  const trail = (id: string) =>
    ancestry(tree, id)
      .slice(1)
      .flatMap((step) => node(step)?.label ?? [])
      .join(" › ");
  const partOf = (moduleId: string) => tree.pathOf.get(moduleId)?.at(-1);
  const partRef = (id: string) =>
    inPart(id) ? `${code(pageOf(id))} (${trail(id)})` : `${trail(id)} (not in this export)`;
  const filePageOf = (path: string) => {
    const part = partOf(`module:${path}`);
    return part !== undefined && inPart(part) ? code(pageOf(part)) : "not in this export";
  };
  const areaName = (id: string) => code(facts.areaLabelOf(id));
  const areaPage = (id: string) => {
    const found = [...tree.nodes.values()].find((candidate) => candidate.area?.id === id);
    return found ? partRef(found.id) : "no page";
  };

  const cyclesTouching = (moduleIds: readonly string[], noun: string) => {
    const inside = new Set(moduleIds.flatMap((id) => facts.modules.get(id)?.path ?? []));

    return bullets(
      facts.cycles
        .filter((cycle) => cycle.files.some((file) => inside.has(file)))
        .map((cycle) => {
          const here = cycle.files.filter((file) => inside.has(file)).length;
          const where =
            here === cycle.files.length ? `all in this ${noun}` : `${here} of ${cycle.files.length} in this ${noun}`;
          return `Cycle #${cycle.number} (${where}), ${severityText(cycle)}: ${cycle.files.map(code).join(", ")}`;
        }),
    );
  };

  const packageLines = (moduleIds: readonly string[]) =>
    bullets(facts.packages(moduleIds).map((entry) => `${code(entry.name)}: ${plural(entry.files, "file")}`));

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
        return data.lanes.find((lane) => lane.side === part.side)?.description ?? "";
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

  const layerLines = (layers: Layers, limit: number) =>
    [
      factLines([
        ["Layer order", layers.order.map(areaName).join(", ")],
        [
          "Imports pointing back",
          shareText(layers.back.length, layers.between, "import between areas", "imports between areas"),
        ],
        ["Search", layers.approximate ? "heuristic, may not be the fewest" : "exact"],
      ]),
      ...(layers.back.length === 0
        ? []
        : [
            `${bullets(layers.back.slice(0, limit).map(edgeText))}${
              layers.back.length > limit ? `\n- And ${layers.back.length - limit} more in \`_areas.md\`.` : ""
            }`,
          ]),
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
    const functions = facts.functionsOf(module.id);
    const notable = functions.filter((fn) => fn.ccBand !== "low" || holdsInside(fn));
    const classes = facts.classesOf(module.id).filter((cls) => cls.inclusive >= highFrom);
    const cycle = facts.cycles.find((candidate) => candidate.number === file.cycle);
    const warnings = facts.diagnostics.filter((diagnostic) => diagnostic.file === file.path);

    return [
      subsection(
        code(file.path),
        factLines([
          ["Entry point", file.entry],
          ...(data.framework === null
            ? []
            : ([
                ["Reached on the client", chain(file.chains.client)],
                ["Reached on the server", chain(file.chains.server)],
              ] as const)),
          ["Barrel", file.barrel ? "yes" : "no"],
          ["Fan-in", fanText(file.fanIn, file.fanInRank, file.side, file.barrel ? "barrel" : "entry point")],
          ["Fan-out", fanText(file.fanOut, file.fanOutRank, file.side, "barrel")],
          ["Visibility fan-in", file.visibility.fanIn],
          ["Visibility fan-out", file.visibility.fanOut],
          ["Role", file.visibility.role],
          ["Functions", file.functionCount],
          ["Functions above CC 10", notable.filter((fn) => fn.ccBand !== "low").length],
          ["Decisions", file.decisions],
          ["Excess CC", file.excessCC],
          ["Max CC", file.maxCC === null ? null : `${file.maxCC} (${file.maxCcBand ?? "none"})`],
          [
            "Cycle",
            cycle
              ? `#${cycle.number} (${cycle.files
                  .filter((other) => other !== file.path)
                  .map(code)
                  .join(", ")})`
              : null,
          ],
          ["Packages", file.packages.length === 0 ? null : file.packages.map(code).join(", ")],
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
      ...notable.map(functionSection),
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

  const filed = modules.toSorted((a, b) => byText(a.path, b.path));
  add(
    "_files.md",
    page(
      `Files: ${plural(filed.length, "source file")} on ${plural(new Set(filed.map((module) => partOf(module.id))).size, "part page")}`,
      "Files",
      "Every scanned source file with the part page that describes it. Find a file with `grep 'src/lib/x.ts' _files.md`.",
      bullets(filed.map((module) => `${code(module.path)} → ${filePageOf(module.path)}`)),
    ),
  );

  const cycles = facts.cycles.filter((cycle) => touches(cycle.files));
  const cycleFiles = new Set(cycles.flatMap((cycle) => cycle.files));
  add(
    "_cycles.md",
    page(
      `Import cycles: ${plural(cycles.length, "cycle")} · ${plural(cycleFiles.size, "file")}`,
      "Import cycles",
      ...(cycles.length === 0
        ? ["none"]
        : cycles.map((cycle) =>
            section(
              `Cycle #${cycle.number}`,
              [
                factLines([
                  ["Files", cycle.files.length],
                  ["Severity", cycle.severity.severity],
                  ["Loops", cycle.severity.loops],
                  ["Imports inside", cycle.severity.edges],
                  [
                    "Smallest cut",
                    cycle.cuts[0]
                      ? `${plural(cycle.cuts[0].length, "import")}, ${plural(cycle.cuts.length, "choice")} (${searchText(cycle)})`
                      : "none found",
                  ],
                  ["Without type imports", typesText(cycle)],
                  [
                    "File pairs passing through",
                    `${cycle.reach.pairs} (visibility fan-in ${cycle.reach.fanIn} × fan-out ${cycle.reach.fanOut})`,
                  ],
                ]),
                `- Files in it:\n${nested(cycle.files.map((file) => `${code(file)} (${filePageOf(file)})`))}`,
                `- Cut choices:\n${nested(cycle.cuts.slice(0, shownCuts).map((cut, index) => `Choice ${index + 1}: ${cutText(cut)}`))}`,
                `- Imports inside:\n${nested(cycle.edges.map(edgeText))}`,
              ].join("\n"),
            ),
          )),
    ),
  );

  const allPackages = facts.packages(modules.map((module) => module.id));
  add(
    "_packages.md",
    page(
      `External packages: ${plural(allPackages.length, "package")}`,
      "External packages",
      ...(allPackages.length === 0
        ? ["none"]
        : allPackages.map((entry) =>
            section(
              code(entry.name),
              `${factLines([["Files", entry.files]])}\n${bullets(
                modules
                  .filter((module) => module.externals.includes(entry.name))
                  .map((module) => code(module.path))
                  .toSorted(byText),
              )}`,
            ),
          )),
    ),
  );

  const diagnostics = facts.diagnostics.filter((diagnostic) => includedPaths.has(diagnostic.file));
  add(
    "_diagnostics.md",
    page(
      `Warnings: ${diagnostics.length}`,
      "Warnings",
      bullets(
        diagnostics.map(
          (diagnostic) =>
            `${code(diagnostic.file)} line ${orNone(diagnostic.line)}, ${diagnostic.kind}: ${diagnostic.message}`,
        ),
      ),
    ),
  );

  const routes = facts.routes.filter((route) => touches([...route.reach.client, ...route.reach.server]));
  const routePages = new Map<string, string>();
  const usedRoutes = new Map<string, number>();
  routes.forEach((route) => {
    const base = slug(route.directory) || "route";
    const count = (usedRoutes.get(base) ?? 0) + 1;
    usedRoutes.set(base, count);
    routePages.set(route.id, `_routes/${count === 1 ? base : `${base}-${count}`}.md`);
  });

  add(
    "_routes/_index.md",
    page(
      `Routes: ${routes.length}`,
      "Routes",
      bullets(
        routes.map(
          (route) =>
            `${code(route.url)} in ${code(route.directory)} (${code(routePages.get(route.id) ?? "")}): ${plural(route.files.length, "route file")}, reaches ${plural(route.reach.client.length, "client file")} and ${plural(route.reach.server.length, "server file")}`,
        ),
      ),
    ),
  );

  routes.forEach((route) => {
    const packageList = (list: typeof route.packages.client) =>
      bullets(list.map((entry) => `${code(entry.name)}: ${plural(entry.files, "file")}`));

    add(
      routePages.get(route.id) ?? "_routes/route.md",
      page(
        `Route ${route.url}: ${plural(route.files.length, "route file")} · reaches ${plural(route.reach.client.length, "client file")}, ${plural(route.reach.server.length, "server file")}`,
        `Route ${route.url}`,
        section(
          "Facts",
          factLines([
            ["URL", code(route.url)],
            ["App", code(route.app || ".")],
            ["Directory", code(route.directory)],
          ]),
        ),
        section("Route files", bullets(route.files.map((file) => `${file.role} (${file.side}): ${code(file.path)}`))),
        section("Layouts", bullets(route.layouts.map(code))),
        section("Reached on the client", bullets(route.reach.client.map(code))),
        section("Reached on the server", bullets(route.reach.server.map(code))),
        section("Packages on the client", packageList(route.packages.client)),
        section("Packages on the server", packageList(route.packages.server)),
      ),
    );
  });

  const scopeSides = new Set(modules.map((module) => module.placement.side));
  const scopeAreas = new Set(modules.flatMap((module) => (module.areaId === null ? [] : [module.areaId])));
  const touchesArea = (...ids: readonly string[]) => ids.some((id) => scopeAreas.has(id));
  const layerSides = facts.layers.filter((layers) => scopeSides.has(layers.side));

  add(
    "_areas.md",
    page(
      `Areas: ${[
        plural(data.areas.filter((area) => area.parent === null && scopeAreas.has(area.id)).length, "area"),
        ...layerSides.map((layers) => `${layers.side} ${percent(layers.back.length, layers.between)} pointing back`),
      ].join(" · ")}`,
      "Areas",
      "Areas are found within each side, so every number here is about imports between files of the same side.",
      ...[...new Set(data.areas.filter((area) => scopeAreas.has(area.id)).map((area) => area.side))].map((side) => {
        const layers = facts.layers.find((entry) => entry.side === side);
        const top = data.areas.filter((area) => area.side === side && area.parent === null && scopeAreas.has(area.id));
        const twoWay = facts.twoWay.filter((pair) => pair.side === side && touchesArea(pair.a, pair.b));
        const areaLine = (id: string) => {
          const coupling = facts.areaFacts.get(id);
          return coupling
            ? `${areaName(id)}, ${areaPage(id)}: ${plural(coupling.files, "file")}, cohesion ${ratioText(coupling.cohesion)}, instability ${ratioText(coupling.instability)}, ${coupling.incoming} in, ${coupling.outgoing} out`
            : areaName(id);
        };

        return section(
          `${sideLabel(side)} (${side})`,
          [
            layers ? layerLines(layers, layers.back.length) : "- Layer order: fewer than two areas",
            subsection(
              "Areas",
              bullets(
                top.map((area) => {
                  const subs = data.areas.filter((sub) => sub.parent === area.id);
                  return `${areaLine(area.id)}${subs.length === 0 ? "" : `\n${nested(subs.map((sub) => areaLine(sub.id)))}`}`;
                }),
              ),
            ),
            subsection(
              "Imports between areas",
              bullets(
                facts.areaLinks
                  .filter((link) => link.side === side && touchesArea(link.from, link.to))
                  .map((link) => `${areaName(link.from)} → ${areaName(link.to)}: ${plural(link.imports, "import")}`),
              ),
            ),
            subsection(
              "Two-way dependencies",
              bullets(
                twoWay.map((pair) => `${areaName(pair.a)} and ${areaName(pair.b)}: ${pair.ab} → and ${pair.ba} ←`),
              ),
            ),
          ].join("\n\n"),
        );
      }),
    ),
  );

  const healthSides = facts.health.filter((entry) => scopeSides.has(entry.side));
  add(
    "_health.md",
    page(
      `Health: ${healthSides
        .map(
          (entry) =>
            `${entry.side} propagation cost ${entry.propagationCost === null ? "none" : percent(entry.propagationCost, 1)}`,
        )
        .join(" · ")}`,
      "Health",
      "How each side looks as a whole, with the side's number of files. None of these numbers gets a band or a verdict; what each one means is at the end of this page. Every number is measured on the whole project, also in a part export.",
      ...healthSides.map((entry) =>
        section(
          `${sideLabel(entry.side)} (${entry.side}), ${plural(entry.files, "file")}`,
          factLines([
            ["Files", entry.files],
            ["Propagation cost", entry.propagationCost === null ? null : percent(entry.propagationCost, 1)],
            ["Largest cycle", entry.largestCycle === 0 ? "none" : shareText(entry.largestCycle, entry.files, "file")],
            [
              "Imports pointing back",
              entry.layers
                ? `${shareText(entry.layers.back.length, entry.layers.between, "import between areas", "imports between areas")}${entry.layers.approximate ? ", approximate" : ""}`
                : "not measured: fewer than two areas",
            ],
            [
              "Complex decisions, counting conditions",
              shareText(
                entry.complexity.conditions.moderate + entry.complexity.conditions.high,
                entry.complexity.conditions.total,
                "decision",
              ),
            ],
            [
              "Complex decisions, branches only",
              shareText(
                entry.complexity.branches.moderate + entry.complexity.branches.high,
                entry.complexity.branches.total,
                "branch",
                "branches",
              ),
            ],
            ["Modularity of areas", entry.modularity.areas === null ? null : entry.modularity.areas.toFixed(2)],
            ["Modularity of folders", entry.modularity.folders === null ? null : entry.modularity.folders.toFixed(2)],
          ]),
        ),
      ),
      section("What the numbers mean", bullets(healthNotes.map(([label, text]) => `${label}: ${text}`))),
    ),
  );

  const scopedFunctions = modules.flatMap((module) => facts.functionsOf(module.id));
  const high = scopedFunctions
    .filter((fn) => fn.ccBand === "high")
    .toSorted((a, b) => b.cc - a.cc || byText(a.file, b.file) || a.line - b.line);
  const heldInside = scopedFunctions
    .filter(holdsInside)
    .toSorted((a, b) => b.inclusive - a.inclusive || byText(a.file, b.file) || a.line - b.line);
  const bigClasses = modules
    .flatMap((module) => facts.classesOf(module.id))
    .filter((cls) => cls.inclusive >= highFrom)
    .toSorted((a, b) => b.inclusive - a.inclusive || byText(a.file, b.file) || a.line - b.line);
  const excess = modules
    .filter((module) => module.metrics.excessCC > 0)
    .toSorted((a, b) => b.metrics.excessCC - a.metrics.excessCC || byText(a.path, b.path));
  const leafParts = [...tree.nodes.values()]
    .filter((part) => part.kind !== "root" && part.children.length === 0 && inPart(part.id))
    .map((part) => ({ part, stats: facts.stats(part.moduleIds) }))
    .filter((entry) => entry.stats.excessCC > 0)
    .toSorted((a, b) => b.stats.excessCC - a.stats.excessCC || byText(pageOf(a.part.id), pageOf(b.part.id)));
  const through = modules
    .filter((module) => pairsOf(module) > 1)
    .toSorted((a, b) => pairsOf(b) - pairsOf(a) || byText(a.path, b.path));
  const findingCycles = cycles.toSorted((a, b) => b.reach.pairs - a.reach.pairs || a.number - b.number);
  const barrels = modules.filter((module) => module.barrel).map((module) => module.path);
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
            return `${code(module.path)} (${module.placement.side}, ${file.visibility.role}): ${pairsOf(module)} file pairs (${file.visibility.fanIn} × ${file.visibility.fanOut}); fan-in ${file.fanIn}, fan-out ${file.fanOut}${file.cycle === null ? "" : `, cycle #${file.cycle}`}`;
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

  add(
    "_definitions.md",
    page(
      "Definitions: what each label in this export counts",
      "Definitions",
      ...definitions.map(([label, text]) => section(label, text)),
    ),
  );

  const all = facts.stats(modules.map((module) => module.id));
  const scopeName = scopeNode ? (names.get(scopeNode.id) ?? "") : "";
  const scoped = scopeNode !== undefined && scopeNode.kind !== "root";
  const scopeTitle = scoped ? `${trail(scopeNode.id)} (${scopeName})` : data.name;
  const sideScale = (side: Side) => facts.scaleOf(side);
  const cutoffText = (label: string, scale: ReturnType<typeof sideScale>["fanIn"]) => {
    const { cutoffs, population } = scale;
    const parts = [
      ...(cutoffs.moderate === null ? [] : [`moderate from ${cutoffs.moderate}`]),
      ...(cutoffs.high === null ? [] : [`high from ${cutoffs.high}`]),
      ...(cutoffs.extreme === null ? [] : [`extreme from ${cutoffs.extreme}`]),
    ];
    if (population === 0) return `- ${label}: no ranked files`;

    return `- ${label}: ${parts.length > 0 ? parts.join(", ") : "all values equal"} (of ${plural(population, "ranked file")})`;
  };
  const judgementSides = data.lanes.map((lane) => lane.side).filter((side) => scopeSides.has(side));

  add(
    "_index.md",
    page(
      `${scopeTitle}: ${statsLine(all)}`,
      scopeTitle,
      ...(scoped
        ? [
            section(
              "Scope",
              factLines([
                ["Scope", scopeName],
                ["Scope label", scopeNode.label],
                ["Scope kind", kindLabel[scopeNode.kind]],
                ["Files in scope", `${modules.length} of ${data.modules.length}`],
                ["Start", code(pageOf(scopeNode.id))],
              ]),
            ),
          ]
        : []),
      section(
        "About this export",
        factLines([
          ["Project", data.name],
          ["Project root", code(data.root)],
          ["Framework", data.framework],
          ["Scanned", data.scannedAt],
          ["Scan duration", `${data.durationMs} ms`],
          ["Exported", options.exportedAt],
        ]),
      ),
      section(
        "How to read this directory",
        bullets([
          "It is a snapshot of code metrics measured by Laqueus when the project was scanned. It does not change when the code does; export again for fresh numbers.",
          ...(scoped
            ? [
                `It covers only ${code(scopeName)} (${scopeNode.label}): pages exist for its parts. Files outside it still appear by path where they import or are imported, and every number is measured against the whole project.`,
              ]
            : []),
          "Start with `_health.md` for how each side looks as a whole, then `_findings.md` for what stands out: complex functions, logic held in inner functions, the files most changes pass through, cycles with the imports that would break them, and layers between areas.",
          "The project is split into parts the way `laqueus list` splits it: one folder per side, e.g. `server/_index.md`, and in it one page per area, sub-area or folder, e.g. `server/src-lib.md`. A part page describes the part, what it depends on and what uses it, then each of its files.",
          "`_files.md` lists every source file with the page that describes it, e.g. `grep 'src/lib/x.ts' _files.md`.",
          "The first line of every page is a one-line summary. Read first lines to scan a level, e.g. `head -qn1 server/*.md`.",
          'Facts are written as `- Label: value` lines, so they can be searched, e.g. `grep -rn "Cycle: #<n>" .` for the files of one cycle.',
          "Test files are not scanned (see Scope in `_definitions.md`).",
          "Also: `_areas.md`, `_cycles.md`, `_packages.md`, `_routes/_index.md`, `_diagnostics.md`. What each label counts: `_definitions.md`.",
        ]),
      ),
      section(
        "Sides",
        bullets(
          data.lanes
            .filter((lane) => scopeSides.has(lane.side))
            .map((lane) => {
              const sideNode = `side:${lane.side}`;
              return `${inPart(sideNode) ? code(pageOf(sideNode)) : code(lane.side)}: ${lane.label}, ${plural(data.modules.filter((module) => module.placement.side === lane.side).length, "file")}. ${lane.description}`;
            }),
        ),
      ),
      section(
        "Totals",
        factLines([
          ["Files", data.modules.length],
          ["Import edges", data.dependencyEdges.length],
          ["Type-only import edges", data.dependencyEdges.filter((edge) => edge.typeOnly).length],
          ["Cycles", facts.cycles.length],
          ["Areas", data.areas.filter((area) => area.parent === null).length],
          ["Routes", data.routes.length],
          ["Warnings", data.diagnostics.length],
          ["Functions", data.functions.length],
          ["Local call edges", data.callEdges.length],
        ]),
      ),
      section(
        "Judgement bands",
        [
          `- CC bands: low 1–${excessFrom}, moderate ${excessFrom + 1}–${highFrom - 1}, high ${highFrom}+ (fixed thresholds)`,
          ...judgementSides.flatMap((side) => [
            cutoffText(`Fan-in, ${side}`, sideScale(side).fanIn),
            cutoffText(`Fan-out, ${side}`, sideScale(side).fanOut),
            `- Visibility medians, ${side}: fan-in ${sideScale(side).medians.fanIn}, fan-out ${sideScale(side).medians.fanOut}`,
          ]),
          "- Cycle severity: minor (2 files), moderate (3–5), severe (6+)",
        ].join("\n"),
      ),
    ),
  );

  return collisions.length > 0
    ? err(`Two pages would be written to the same path: ${[...new Set(collisions)].join(", ")}`)
    : ok(pages);
};
