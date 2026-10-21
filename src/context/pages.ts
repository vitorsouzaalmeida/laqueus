import {
  type CycleEdge,
  type Facts,
  type FunctionFacts,
  type ImportRef,
  type Stats,
  branchStep,
  byText,
  shownCuts,
} from "../facts";
import { ccBand, hubFloor, hubRank } from "../judgement";
import { largestCut } from "../metrics";
import { type ModuleNode, type Result, type Side, err, ok } from "../model";
import { type Tree, type TreeNode, ancestry, partNames, slug } from "../tree";
import { bullets, code, factLines, orNone, page, plural, section, table } from "./markdown";

export type Pages = Map<string, string>;

export type PageOptions = { exportedAt: string; scope?: string };

type Entry = { key: string; label: string; page: string; moduleIds: readonly string[] };

type Part = {
  moduleIds: readonly string[];
  entries: readonly Entry[];
  branchOf?: (moduleId: string) => string | undefined;
  describeBranch: (key: string) => readonly [label: string, page: string | null];
  noun: string;
};

const parentOf = (filePath: string) => (filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "");
const baseName = (filePath: string) => filePath.slice(filePath.lastIndexOf("/") + 1);

const prefixes = (directory: string) =>
  directory === "" ? [""] : ["", ...directory.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"))];

const directoryPage = (directory: string) => (directory === "" ? "_index.md" : `${directory}/_index.md`);
const filePage = (filePath: string) => `${filePath}.md`;

export const statsLine = (stats: Stats) =>
  [
    plural(stats.files, "file"),
    plural(stats.entryPoints, "entry point"),
    plural(stats.functions, "function"),
    `max CC ${orNone(stats.maxCC)}`,
    `${stats.filesInCycles} in cycles`,
    `imports ${stats.imports.internal} internal, ${stats.imports.incoming} in, ${stats.imports.outgoing} out`,
  ].join(" · ");

const statsHeader = [
  "Files",
  "Entry points",
  "Functions",
  "Max CC",
  "Files in cycles",
  "Imports internal",
  "Imports in",
  "Imports out",
];

const statsCells = (stats: Stats) => [
  stats.files,
  stats.entryPoints,
  stats.functions,
  orNone(stats.maxCC),
  stats.filesInCycles,
  stats.imports.internal,
  stats.imports.incoming,
  stats.imports.outgoing,
];

const statsFacts = (stats: Stats) =>
  factLines(statsHeader.map((label, index) => [label, statsCells(stats)[index] ?? null] as const));

const lineList = (values: readonly number[]) => `line${values.length === 1 ? "" : "s"} ${values.join(", ")}`;

const chain = (paths: readonly string[] | null) => (paths ? paths.map(code).join(" → ") : "no");

const callList = (refs: FunctionFacts["calls"]) =>
  refs.length === 0 ? "none" : refs.map((ref) => `${code(ref.name)} (${lineList(ref.lines)})`).join(", ");

const functionSection = (fn: FunctionFacts) => {
  const decisions = fn.logic
    ? [
        `- Decisions: ${fn.logic.decisions.length}`,
        ...fn.logic.decisions.map(
          (decision) => `  - line ${decision.line} (+${decision.weight}, ${decision.kind}): ${code(decision.label)}`,
        ),
        `- Ways out: ${fn.logic.waysOut}`,
      ].join("\n")
    : "- Decisions: not included in this export\n- Ways out: not included in this export";
  return `### ${code(fn.name)} (line ${fn.line})\n\n${[
    `- CC: ${fn.cc}`,
    `- CC band: ${fn.ccBand}`,
    decisions,
    `- Calls: ${callList(fn.calls)}`,
    `- Called by: ${callList(fn.calledBy)}`,
  ].join("\n")}`;
};

const importNote = (ref: ImportRef) =>
  `${lineList(ref.lines)}${ref.via.length === 0 ? "" : `, via ${ref.via.map(code).join(", ")}`}`;

const edgeText = (edge: CycleEdge) =>
  `${code(edge.from)} → ${code(edge.to)} (${lineList(edge.lines)}: ${edge.names.map(code).join(", ")})`;

const cutText = (cut: readonly CycleEdge[]) => cut.map(edgeText).join("; ");

const percent = (count: number, total: number) => (total === 0 ? "0%" : `${((count / total) * 100).toFixed(1)}%`);

const nearestRank = (sorted: readonly number[], p: number) =>
  sorted.length === 0 ? null : (sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? null);

const ratioText = (value: number | null) => (value === null ? "none" : value.toFixed(2));

const shownHigh = 50;

const definitions: readonly (readonly [string, string])[] = [
  [
    "CC",
    "Cyclomatic complexity of one function: 1, plus 1 for each if, loop (for, for-in, for-of, while, do-while), catch, ternary, && / ||, case with a test and logical assignment (&&=, ||=). Checks for undefined values add nothing: optional chains (?.), ?? and ??=, and default values. Nested functions and classes are measured on their own.",
  ],
  [
    "Function names",
    "A function passed to a call is named after the function holding it and the call, e.g. `load › db.transaction callback`; other unnamed functions are `<anonymous>@<line>`, also prefixed by the function holding them.",
  ],
  ["Max CC", "Highest CC among the functions of a file, or of every file in a part. none when there is no function."],
  ["Mean CC", "Mean CC of the functions of a file, rounded to two decimals. none when there is no function."],
  ["Decisions", "The steps of a function that add to its CC, each with how much it adds. CC equals 1 plus their sum."],
  ["Ways out", "Points where a function can end: each return, each throw, and the end of its body."],
  [
    "Calls, Called by",
    "Calls between functions of the same file that the scan could resolve. Calls across files are not tracked.",
  ],
  [
    "Fan-in",
    "Number of distinct project files that import this file, not counting test files and the file itself. An import from a barrel counts against the file that defines the imported name.",
  ],
  ["Test fan-in", "Number of distinct test files that import this file."],
  [
    "Fan-out",
    "Number of distinct project files this file imports, not counting itself. An import from a barrel counts against the file that defines the imported name.",
  ],
  [
    "Barrel",
    "A file that only re-exports names from other files (export … from, export *, or import then export), with no code of its own. Imports of a name through a barrel are followed to the file that defines it, and are listed with `via` and the barrel. A whole-module import (import * as, import(), side-effect import) stays on the barrel. Sides are found from the imports as written, since SvelteKit loads everything a barrel re-exports.",
  ],
  [
    "Imports internal, Imports in, Imports out",
    "Import edges, counted once per importing file and imported file however many statements join them; type-only imports are ignored. Internal: both files inside the part. In: from a file outside to one inside. Out: from a file inside to one outside.",
  ],
  ["Imports between entries", "Import edges from one entry of a part's contents to another, counted as above."],
  [
    "Imports crossing",
    "Import edges between a part and the rest of the project, grouped where the outside file branches off the part's path: a sibling directory or file, or a sibling node of the map. Outgoing: from the part to it. Incoming: from it into the part.",
  ],
  [
    "Cycle",
    "Files that import each other in a loop, found as strongly connected components with Tarjan's algorithm. A file that imports itself is a cycle of one. Cycles are numbered from 1 in the order of their first file path.",
  ],
  [
    "Island",
    "Weakly connected component of the import graph: files linked by imports in either direction, with no import between two islands. Numbered from 0.",
  ],
  [
    "Side",
    "Where a file runs, found by walking imports from the SvelteKit entry points. The sides and their meaning are listed in _index.md.",
  ],
  [
    "Area, Sub-area",
    "Groups of files found with the Louvain method on the import graph, stopped after two levels. Files in the same folder get a weak extra link. Each area is named after the folder most of its files live in. Internal imports: imports with both files in the area. Touching imports: imports with at least one file in it and the other in some area; imports from tests, tooling and unreached files are left out.",
  ],
  [
    "Cohesion",
    "Internal imports divided by touching imports, from 0 to 1. Higher means the area mostly imports itself.",
  ],
  [
    "Instability",
    "Imports from the area to other areas divided by all imports between the area and other areas (in + out), from 0 to 1. 0: other areas depend on it and it depends on none (stable). 1: it depends on others and none depend on it (unstable).",
  ],
  [
    "Area cycle",
    "Top-level areas that import each other in a loop, found as strongly connected components of the graph of imports between areas. Numbered from 1 in the order of their first area label.",
  ],
  [
    "Stable area depending on a less stable one",
    "An import from area A to area B where A's instability is lower than B's. Stable code is expected to depend on code that is at least as stable; an import the other way makes the stable area change when the unstable one does.",
  ],
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
    "Fixed thresholds on cyclomatic complexity: low (1–10), moderate (11–15), high (16+). These do not change with project size.",
  ],
  ["Max CC band", "The CC band of a file's highest-complexity function. none when the file has no functions."],
  [
    "Fan-in band, Fan-out band",
    "Percentile rank of a file's fan-in or fan-out among the files of its own side (client, shared, server…). The percentile is floor(100 × count of files of the side with a strictly lower value / files of the side). Bands: low (below P75), moderate (P75–P89), high (P90–P94), extreme (P95+). The thresholds adapt to each project and side.",
  ],
  [
    "Hub",
    `A file in the top quartile of both fan-in and fan-out within its side (percentile rank ≥ ${hubRank} on both), with at least ${hubFloor} of each. Barrels are never hubs. It depends on many files and many files depend on it.`,
  ],
  [
    "Cycle severity",
    "Size of the strongly connected component: minor (≤ 2 files), moderate (3–5), severe (6+). Larger cycles are harder to break.",
  ],
  [
    "Density",
    "Directed import edges inside a cycle divided by the maximum possible (size × (size − 1)), excluding self-imports. Ranges from 0 to 1; higher means more tangled.",
  ],
  [
    "Smallest cut",
    `The fewest imports inside a cycle whose removal leaves no cycle among its files, each with the names it imports. Every choice of that size is listed, fewest imported names first, at most ${shownCuts}. Only cuts of up to ${largestCut} imports are searched.`,
  ],
  [
    "Median CC, P90 CC, P95 CC, P99 CC",
    "Nearest-rank percentiles of the CC of the functions in the export: the smallest CC that at least that share of functions do not exceed.",
  ],
  ["Lines", "Lines are 1-based."],
];

const scaleLine = (label: string, scale: ReturnType<Facts["scaleOf"]>["fanIn"]): string => {
  const { cutoffs, population } = scale;
  const parts: string[] = [];
  if (cutoffs.moderate !== null) parts.push(`moderate from ${cutoffs.moderate}`);
  if (cutoffs.high !== null) parts.push(`high from ${cutoffs.high}`);
  if (cutoffs.extreme !== null) parts.push(`extreme from ${cutoffs.extreme}`);
  return parts.length > 0
    ? `- ${label}: ${parts.join(", ")} (of ${plural(population, "file")})`
    : `- ${label}: all values equal`;
};

const judgementSection = (facts: Facts, modules: readonly ModuleNode[]): string => {
  const hubs = modules.filter((m) => facts.file(m).bands.hub).map((m) => m.path);
  const sides = facts.data.lanes
    .map((lane) => lane.side)
    .filter((side) => modules.some((module) => module.placement.side === side));
  return [
    "- CC bands: low 1–10, moderate 11–15, high 16+ (fixed thresholds)",
    ...sides.flatMap((side: Side) => [
      scaleLine(`Fan-in, ${side}`, facts.scaleOf(side).fanIn),
      scaleLine(`Fan-out, ${side}`, facts.scaleOf(side).fanOut),
    ]),
    `- Hub rule: percentile rank ≥ ${hubRank} on both fan-in and fan-out within the side, at least ${hubFloor} of each, not a barrel`,
    `- Hubs: ${hubs.length === 0 ? "none" : hubs.map(code).join(", ")}`,
    `- Cycle severity: minor (≤2 files), moderate (3–5), severe (6+)`,
  ].join("\n");
};

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

  const modulesByPath = new Map(data.modules.map((module) => [module.path, module]));
  const laneLabel = new Map(data.lanes.map((lane) => [lane.side, lane.label]));

  const areaLines = (id: string): (readonly [string, string | number | null])[] => {
    const area = data.areas.find((candidate) => candidate.id === id);
    const coupling = facts.areaFacts.get(id);

    return area && coupling
      ? [
          ["Internal imports", area.internalImports],
          ["Touching imports", area.touchingImports],
          ["Cohesion", ratioText(coupling.cohesion)],
          ["Instability", ratioText(coupling.instability)],
          ["Imports from other areas", coupling.incoming],
          ["Imports to other areas", coupling.outgoing],
          ...(area.parent === null
            ? ([["Area cycle", coupling.cycle === null ? null : `#${coupling.cycle}`]] as const)
            : []),
        ]
      : [];
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
          return `Cycle #${cycle.number} (${where}): ${cycle.files.map(code).join(", ")}`;
        }),
    );
  };

  const partSections = (part: Part) => {
    const childOf = new Map(part.entries.flatMap((entry) => entry.moduleIds.map((id) => [id, entry.label] as const)));
    const crossings = part.branchOf ? facts.crossings(part.moduleIds, part.branchOf) : null;

    return [
      section("Summary", statsFacts(facts.stats(part.moduleIds))),
      section(
        "Contents",
        table(
          ["Entry", "Page", ...statsHeader],
          part.entries.map((entry) => [
            code(entry.label),
            code(entry.page),
            ...statsCells(facts.stats(entry.moduleIds)),
          ]),
        ),
      ),
      section(
        "Imports between entries",
        table(
          ["From", "To", "Imports"],
          facts.links(childOf).map((link) => [code(link.from), code(link.to), link.imports]),
        ),
      ),
      ...(crossings
        ? [
            section(
              `Imports crossing this ${part.noun}`,
              table(
                ["Other part", "Page", `Outgoing (this ${part.noun} → it)`, `Incoming (it → this ${part.noun})`],
                crossings.map((crossing) => {
                  const [label, target] = part.describeBranch(crossing.key);
                  return [
                    label,
                    target === null ? "not in this export" : code(target),
                    crossing.outgoing,
                    crossing.incoming,
                  ];
                }),
              ),
            ),
          ]
        : []),
      section(
        "Packages",
        table(
          ["Package", "Files"],
          facts.packages(part.moduleIds).map((entry) => [code(entry.name), entry.files]),
        ),
      ),
      section("Cycles", cyclesTouching(part.moduleIds, part.noun)),
    ];
  };

  type Directory = { path: string; directories: Set<string>; files: ModuleNode[]; moduleIds: string[] };
  const directories = new Map<string, Directory>();
  const directory = (path: string): Directory => {
    const found = directories.get(path);

    if (found) return found;

    const created: Directory = { path, directories: new Set(), files: [], moduleIds: [] };
    directories.set(path, created);
    return created;
  };

  modules.forEach((module) => {
    const steps = prefixes(parentOf(module.path));
    steps.forEach((step, index) => {
      const current = directory(step);
      const next = steps.at(index + 1);
      current.moduleIds.push(module.id);
      if (next !== undefined) current.directories.add(next);
    });
    directory(parentOf(module.path)).files.push(module);
  });

  if (modules.length === 0) directory("");

  const directoryEntries = (current: Directory): Entry[] => [
    ...[...current.directories].toSorted(byText).map((path) => ({
      key: path,
      label: `${baseName(path)}/`,
      page: directoryPage(path),
      moduleIds: directories.get(path)?.moduleIds ?? [],
    })),
    ...current.files
      .toSorted((a, b) => byText(a.path, b.path))
      .map((module) => ({
        key: module.path,
        label: baseName(module.path),
        page: filePage(module.path),
        moduleIds: [module.id],
      })),
  ];

  const directoryPart = (current: Directory): Part => {
    const trail = prefixes(current.path);

    return {
      moduleIds: current.moduleIds,
      entries: directoryEntries(current),
      branchOf:
        current.path === ""
          ? undefined
          : (id) => {
              const module = facts.modules.get(id);
              return module && branchStep(trail, [...prefixes(parentOf(module.path)), module.path]);
            },
      describeBranch: (key) =>
        modulesByPath.has(key)
          ? [code(key), includedPaths.has(key) ? filePage(key) : null]
          : [code(`${key}/`), directories.has(key) ? directoryPage(key) : null],
      noun: "directory",
    };
  };

  directories.forEach((current) => {
    if (current.path === "") return;

    const stats = facts.stats(current.moduleIds);
    add(
      directoryPage(current.path),
      page(`${current.path}/: ${statsLine(stats)}`, `${current.path}/`, ...partSections(directoryPart(current))),
    );
  });

  modules.forEach((module) => {
    const file = facts.file(module);
    const functions = facts.functionsOf(module.id);
    const cycle = facts.cycles.find((candidate) => candidate.number === file.cycle);
    const warnings = facts.diagnostics.filter((diagnostic) => diagnostic.file === file.path);
    const l0 = [
      `${file.path}: ${file.side}`,
      plural(file.functionCount, "function"),
      `max CC ${orNone(file.maxCC)}`,
      `mean CC ${orNone(file.meanCC)}`,
      `fan-in ${file.fanIn}`,
      `fan-out ${file.fanOut}`,
      file.cycle === null ? "no cycle" : `cycle #${file.cycle}`,
    ].join(" · ");
    const importList = (refs: typeof file.imports) =>
      bullets(refs.map((ref) => `${code(ref.path)} (${importNote(ref)})`));

    add(
      filePage(file.path),
      page(
        l0,
        file.path,
        section(
          "Facts",
          factLines([
            ["Side", `${file.side} (${laneLabel.get(file.side) ?? file.side})`],
            ["Area", file.area],
            ["Sub-area", file.subArea],
            ["Entry point", file.entry],
            ["Reason", file.reason],
            ["Reached on the client", chain(file.chains.client)],
            ["Reached on the server", chain(file.chains.server)],
            ["Barrel", file.barrel ? "yes" : "no"],
            ["Fan-in", file.fanIn],
            [
              "Fan-in band",
              `${file.bands.fanInBand} (P${file.bands.fanInPercentile} of ${file.bands.population} ${file.side} files)`,
            ],
            ["Test fan-in", file.testFanIn],
            ["Fan-out", file.fanOut],
            [
              "Fan-out band",
              `${file.bands.fanOutBand} (P${file.bands.fanOutPercentile} of ${file.bands.population} ${file.side} files)`,
            ],
            ["Functions", file.functionCount],
            ["Max CC", file.maxCC],
            ["Max CC band", file.bands.maxCcBand],
            ["Mean CC", file.meanCC],
            [
              "Cycle",
              cycle
                ? `#${cycle.number} (${
                    cycle.files
                      .filter((other) => other !== file.path)
                      .map(code)
                      .join(", ") || "imports itself"
                  })`
                : null,
            ],
            ["Island", file.island],
            ["Hub", file.bands.hub ? "yes" : "no"],
            ["Packages", file.packages.length === 0 ? null : file.packages.map(code).join(", ")],
          ]),
        ),
        section("Imports", importList(file.imports)),
        section("Imported by", importList(file.importedBy)),
        section(
          "Functions",
          [
            table(
              ["Function", "Line", "CC", "CC band", "Calls", "Called by"],
              functions.map((fn) => [code(fn.name), fn.line, fn.cc, fn.ccBand, fn.calls.length, fn.calledBy.length]),
            ),
            ...functions.map(functionSection),
          ].join("\n\n"),
        ),
        section(
          "Warnings",
          table(
            ["Line", "Kind", "Message"],
            warnings.map((warning) => [orNone(warning.line), warning.kind, warning.message]),
          ),
        ),
      ),
    );
  });

  const mapPage = (id: string) => {
    const name = names.get(id) ?? "";
    return name === "" ? "_map/_index.md" : `_map/${name}/_index.md`;
  };
  const inMap = (id: string) => !scopeNode || ancestry(tree, id).includes(scopeNode.id);
  const mapTrail = (id: string) =>
    ancestry(tree, id)
      .flatMap((step) => tree.nodes.get(step)?.label ?? [])
      .join(" › ");

  const nodeDescription = (node: TreeNode) => {
    switch (node.kind) {
      case "root":
        return "The whole project, grouped the way the Laqueus viewer does: by side, then by area and sub-area. Every side is included, also those the viewer hides by default.";
      case "side":
        return data.lanes.find((lane) => lane.side === node.side)?.description ?? "";
      case "folder":
        return "Files in this folder. Small subfolders are merged into their parent.";
      default:
        return node.area?.id === "area:standalone"
          ? "Files that neither import nor are imported by another file, and have no folder mates."
          : "Files that mostly import each other, grouped by the Louvain method and named after the folder that holds most of them.";
    }
  };

  tree.nodes.forEach((node) => {
    if (!inMap(node.id)) return;

    const children = node.children.flatMap((id) => tree.nodes.get(id) ?? []);
    const entries: Entry[] =
      children.length > 0
        ? children.map((child) => ({
            key: child.id,
            label: child.label,
            page: mapPage(child.id),
            moduleIds: child.moduleIds,
          }))
        : node.moduleIds
            .flatMap((id) => facts.modules.get(id) ?? [])
            .toSorted((a, b) => byText(a.path, b.path))
            .map((module) => ({
              key: module.id,
              label: module.path,
              page: filePage(module.path),
              moduleIds: [module.id],
            }));
    const trail = ancestry(tree, node.id);
    const stats = facts.stats(node.moduleIds);
    const kind = { root: "map", side: "side", area: "area", subarea: "sub-area", folder: "folder" }[node.kind];

    add(
      mapPage(node.id),
      page(
        `${node.kind === "root" ? `Map of ${data.name}` : mapTrail(node.id)}: ${statsLine(stats)}`,
        node.kind === "root" ? `Map of ${data.name}` : mapTrail(node.id),
        section(
          "About",
          [
            factLines([
              ["Kind", kind],
              ...(node.side === null ? [] : ([["Side", node.side]] as const)),
              ...(node.area ? areaLines(node.area.id) : []),
            ]),
            nodeDescription(node),
          ].join("\n\n"),
        ),
        ...partSections({
          moduleIds: node.moduleIds,
          entries,
          branchOf:
            node.kind === "root" ? undefined : (id) => branchStep(trail, [...(tree.pathOf.get(id) ?? ["root"]), id]),
          describeBranch: (key) => {
            const module = facts.modules.get(key);
            return module
              ? [code(module.path), includedPaths.has(module.path) ? filePage(module.path) : null]
              : [mapTrail(key), inMap(key) ? mapPage(key) : null];
          },
          noun: kind,
        }),
      ),
    );
  });

  const cycles = facts.cycles.filter((cycle) => touches(cycle.files));
  const cycleFiles = new Set(cycles.flatMap((cycle) => cycle.files));
  add(
    "_cycles.md",
    page(
      `Import cycles: ${plural(cycles.length, "cycle")} · ${plural(cycleFiles.size, "file")}`,
      "Import cycles",
      ...(cycles.length === 0
        ? ["none"]
        : cycles.map((cycle) => {
            const bands = facts.cycleBands.get(cycle.number);
            const bandLines = bands
              ? `\n- Severity: ${bands.severity}\n- Edges: ${bands.edges}\n- Density: ${bands.density === null ? "none" : bands.density.toFixed(2)}`
              : "";
            const smallest = cycle.cuts[0];
            const cutLines = smallest
              ? [
                  `- Smallest cut: ${plural(smallest.length, "import")}, ${plural(cycle.cuts.length, "choice")}`,
                  ...cycle.cuts.slice(0, shownCuts).map((cut, index) => `  - Choice ${index + 1}: ${cutText(cut)}`),
                ].join("\n")
              : `- Smallest cut: none of ${largestCut} imports or fewer`;
            return section(
              `Cycle #${cycle.number}`,
              [
                `- Files: ${cycle.files.length}${bandLines}`,
                bullets(cycle.files.map(code)),
                `${cutLines}\n`,
                `### Imports inside cycle #${cycle.number}\n\n${bullets(cycle.edges.map(edgeText))}`,
              ].join("\n"),
            );
          })),
    ),
  );

  const allPackages = facts.packages(modules.map((module) => module.id));
  add(
    "_packages.md",
    page(
      `External packages: ${plural(allPackages.length, "package")}`,
      "External packages",
      section(
        "Packages",
        table(
          ["Package", "Files"],
          allPackages.map((entry) => [code(entry.name), entry.files]),
        ),
      ),
      ...allPackages.map((entry) =>
        section(
          code(entry.name),
          bullets(
            modules
              .filter((module) => module.externals.includes(entry.name))
              .map((module) => code(module.path))
              .toSorted(byText),
          ),
        ),
      ),
    ),
  );

  const diagnostics = facts.diagnostics.filter((diagnostic) => includedPaths.has(diagnostic.file));
  add(
    "_diagnostics.md",
    page(
      `Warnings: ${diagnostics.length}`,
      "Warnings",
      table(
        ["File", "Line", "Kind", "Message"],
        diagnostics.map((diagnostic) => [
          code(diagnostic.file),
          orNone(diagnostic.line),
          diagnostic.kind,
          diagnostic.message,
        ]),
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
      table(
        ["URL", "App", "Directory", "Page", "Route files", "Client files reached", "Server files reached"],
        routes.map((route) => [
          code(route.url),
          code(route.app || "."),
          code(route.directory),
          code(routePages.get(route.id) ?? ""),
          route.files.length,
          route.reach.client.length,
          route.reach.server.length,
        ]),
      ),
    ),
  );

  routes.forEach((route) => {
    const packages = (list: typeof route.packages.client) =>
      table(
        ["Package", "Files"],
        list.map((entry) => [code(entry.name), entry.files]),
      );

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
        section(
          "Route files",
          table(
            ["Role", "Side", "File"],
            route.files.map((file) => [file.role, file.side, code(file.path)]),
          ),
        ),
        section("Layouts", bullets(route.layouts.map(code))),
        section("Reached on the client", bullets(route.reach.client.map(code))),
        section("Reached on the server", bullets(route.reach.server.map(code))),
        section("Packages on the client", packages(route.packages.client)),
        section("Packages on the server", packages(route.packages.server)),
      ),
    );
  });

  const scopeAreas = new Set(modules.flatMap((module) => (module.areaId === null ? [] : [module.areaId])));
  const topAreas = data.areas.filter(
    (area) => area.parent === null && area.id !== "area:standalone" && scopeAreas.has(area.id),
  );
  const touchesArea = (...ids: readonly string[]) => ids.some((id) => scopeAreas.has(id));
  const areaName = (id: string) => code(facts.areaLabelOf(id));
  const areaCycles = facts.areaCycles.filter((cycle) => touchesArea(...cycle.areas));
  const twoWay = facts.twoWay.filter((pair) => touchesArea(pair.a, pair.b));
  const violations = facts.violations.filter((link) => touchesArea(link.from, link.to));
  const areaCycleLines = bullets(
    areaCycles.map(
      (cycle) =>
        `Area cycle #${cycle.number} (${plural(cycle.areas.length, "area")}): ${cycle.areas.map(areaName).join(", ")}`,
    ),
  );
  const twoWayTable = table(
    ["Area A", "Area B", "Imports A → B", "Imports B → A"],
    twoWay.map((pair) => [areaName(pair.a), areaName(pair.b), pair.ab, pair.ba]),
  );
  const violationTable = (list: typeof violations) =>
    table(
      ["From", "Instability", "To", "Instability", "Imports"],
      list.map((link) => [
        areaName(link.from),
        ratioText(link.fromInstability),
        areaName(link.to),
        ratioText(link.toInstability),
        link.imports,
      ]),
    );
  const areaPages = (id: string) =>
    [...tree.nodes.values()]
      .filter((node) => node.area?.id === id && inMap(node.id))
      .map((node) => code(mapPage(node.id)))
      .join(", ") || "not in this export";

  add(
    "_areas.md",
    page(
      `Areas: ${plural(topAreas.length, "area")} · ${plural(areaCycles.length, "area cycle")} · ${plural(twoWay.length, "two-way dependency", "two-way dependencies")}`,
      "Areas",
      section(
        "Areas",
        table(
          [
            "Area",
            "Files",
            "Internal imports",
            "Touching imports",
            "Cohesion",
            "Instability",
            "Imports in",
            "Imports out",
            "Area cycle",
            "Map pages",
          ],
          topAreas.map((area) => {
            const coupling = facts.areaFacts.get(area.id);
            return [
              areaName(area.id),
              area.moduleIds.length,
              area.internalImports,
              area.touchingImports,
              ratioText(coupling?.cohesion ?? null),
              ratioText(coupling?.instability ?? null),
              coupling?.incoming ?? 0,
              coupling?.outgoing ?? 0,
              coupling?.cycle === null || coupling?.cycle === undefined ? "none" : `#${coupling.cycle}`,
              areaPages(area.id),
            ];
          }),
        ),
      ),
      section(
        "Imports between areas",
        table(
          ["From", "To", "Imports"],
          facts.areaLinks
            .filter((link) => touchesArea(link.from, link.to))
            .map((link) => [areaName(link.from), areaName(link.to), link.imports]),
        ),
      ),
      section("Area cycles", areaCycleLines),
      section("Two-way dependencies", twoWayTable),
      section("Stable areas depending on less stable ones", violationTable(violations)),
    ),
  );

  const inScope = new Set(modules.map((module) => module.id));
  const scopedFunctions = data.functions.filter((fn) => inScope.has(fn.moduleId));
  const scores = scopedFunctions.map((fn) => fn.complexity).toSorted((a, b) => a - b);
  const bandCount = (band: ReturnType<typeof ccBand>) => scores.filter((score) => ccBand(score) === band).length;
  const high = scopedFunctions
    .filter((fn) => ccBand(fn.complexity) === "high")
    .toSorted(
      (a, b) =>
        b.complexity - a.complexity || byText(a.location.file, b.location.file) || a.location.line - b.location.line,
    );
  const hubs = modules.map((module) => facts.file(module)).filter((file) => file.bands.hub);
  const findingCycles = facts.cycles.filter((cycle) => touches(cycle.files));
  const barrels = modules.filter((module) => module.barrel).map((module) => module.path);

  add(
    "_findings.md",
    page(
      `Findings: ${plural(high.length, "function")} in the high CC band · ${plural(hubs.length, "hub")} · ${plural(findingCycles.length, "cycle")} · ${plural(areaCycles.length, "area cycle")}`,
      "Findings",
      "What stands out in this export. Each section points to the pages with the details; what each label counts is in `_definitions.md`.",
      section(
        "CC distribution",
        factLines([
          ["Functions", scores.length],
          ["Median CC", nearestRank(scores, 50)],
          ["P90 CC", nearestRank(scores, 90)],
          ["P95 CC", nearestRank(scores, 95)],
          ["P99 CC", nearestRank(scores, 99)],
          ["Max CC", scores.at(-1) ?? null],
          ["Low band", `${bandCount("low")} (${percent(bandCount("low"), scores.length)})`],
          ["Moderate band", `${bandCount("moderate")} (${percent(bandCount("moderate"), scores.length)})`],
          ["High band", `${bandCount("high")} (${percent(bandCount("high"), scores.length)})`],
        ]),
      ),
      section(
        "Functions in the high CC band",
        [
          table(
            ["Function", "CC", "File", "Line"],
            high
              .slice(0, shownHigh)
              .map((fn) => [code(fn.name), fn.complexity, code(fn.location.file), fn.location.line]),
          ),
          ...(high.length > shownHigh ? [`- And ${high.length - shownHigh} more in the high band.`] : []),
        ].join("\n\n"),
      ),
      section(
        "Hubs",
        table(
          ["File", "Side", "Fan-in", "Fan-out", "Test fan-in", "Cycle"],
          hubs.map((file) => [
            code(file.path),
            file.side,
            file.fanIn,
            file.fanOut,
            file.testFanIn,
            file.cycle === null ? "none" : `#${file.cycle}`,
          ]),
        ),
      ),
      section(
        "Import cycles",
        [
          table(
            ["Cycle", "Files", "Severity", "Smallest cut"],
            findingCycles.map((cycle) => [
              `#${cycle.number}`,
              cycle.files.length,
              facts.cycleBands.get(cycle.number)?.severity ?? "none",
              cycle.cuts[0]
                ? `${plural(cycle.cuts[0].length, "import")} (${plural(cycle.cuts.length, "choice")}): ${cutText(cycle.cuts[0])}`
                : `none of ${largestCut} imports or fewer`,
            ]),
          ),
          "Every choice and the imports of each cycle: `_cycles.md`.",
        ].join("\n\n"),
      ),
      section("Area cycles", `${areaCycleLines}\n\n${twoWayTable}\n\nDetails: \`_areas.md\`.`),
      section(
        "Stable areas depending on less stable ones",
        [
          violationTable(violations.slice(0, 10)),
          ...(violations.length > 10 ? [`- And ${violations.length - 10} more in \`_areas.md\`.`] : []),
        ].join("\n\n"),
      ),
      section(
        "Barrels",
        `${factLines([["Barrels", barrels.length]])}\n${barrels.length === 0 ? "" : bullets(barrels.map(code))}`.trim(),
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

  const root = directory("");
  const all = facts.stats(root.moduleIds);
  const entryPoints = [
    ...modules.reduce((map, module) => {
      const label = module.placement.entry;
      return label === null ? map : map.set(label, [...(map.get(label) ?? []), module.path]);
    }, new Map<string, string[]>()),
  ].toSorted(([a], [b]) => byText(a, b));

  const scopeName = scopeNode ? (names.get(scopeNode.id) ?? "") : "";
  const scopeTitle = scopeNode && scopeNode.kind !== "root" ? `${mapTrail(scopeNode.id)} (${scopeName})` : data.name;
  const scopeKind = scopeNode
    ? { root: "project", side: "side", area: "area", subarea: "sub-area", folder: "folder" }[scopeNode.kind]
    : "project";

  add(
    "_index.md",
    page(
      `${scopeTitle}: ${statsLine(all)}`,
      scopeTitle,
      ...(scopeNode && scopeNode.kind !== "root"
        ? [
            section(
              "Scope",
              factLines([
                ["Scope", scopeName],
                ["Scope label", scopeNode.label],
                ["Scope kind", scopeKind],
                ["Files in scope", `${modules.length} of ${data.modules.length}`],
                ["Start", code(mapPage(scopeNode.id))],
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
          ...(scopeNode && scopeNode.kind !== "root"
            ? [
                `It covers only ${code(scopeName)} (${scopeNode.label}): pages exist for its files and the directories holding them. Files outside it still appear by path where they import or are imported, and every number is measured against the whole project.`,
              ]
            : []),
          "The first line of every page is a one-line summary. Read first lines to scan a level, e.g. `head -qn1 src/*/_index.md`.",
          "The page for source file `X` is `X.md`, and every source directory has an `_index.md`. Paths are relative to the project root.",
          "Names starting with `_` are generated pages; everything else mirrors the source tree.",
          `${code(scopeNode && scopeNode.kind !== "root" ? mapPage(scopeNode.id) : "_map/_index.md")} groups the files the way the Laqueus viewer does: by side (client, server…), then by area and sub-area.`,
          'Facts are written as `- Label: value` lines, so they can be searched, e.g. `grep -rl "Cycle: #<n>" .` for the files of one cycle.',
          "Start with `_findings.md` for what stands out: the CC distribution, the most complex functions, hubs, cycles with the imports that would break them, and coupling between areas.",
          "Also: `_cycles.md`, `_areas.md`, `_packages.md`, `_routes/_index.md`, `_diagnostics.md`. What each label counts: `_definitions.md`.",
        ]),
      ),
      section(
        "Totals",
        factLines([
          ["Files", data.modules.length],
          ["Import edges", data.dependencyEdges.length],
          ["Cycles", facts.cycles.length],
          ["Areas", data.areas.filter((area) => area.parent === null).length],
          ["Routes", data.routes.length],
          ["Warnings", data.diagnostics.length],
          ["Functions", data.functions.length],
          ["Local call edges", data.callEdges.length],
        ]),
      ),
      section("Judgement bands", judgementSection(facts, modules)),
      section(
        "Sides",
        table(
          ["Side", "Label", "Files", "Map page", "Meaning"],
          data.lanes.map((lane) => {
            const node = tree.nodes.get(`side:${lane.side}`);
            return [
              lane.side,
              lane.label,
              data.modules.filter((module) => module.placement.side === lane.side).length,
              node && inMap(node.id) ? code(mapPage(node.id)) : "not in this export",
              lane.description,
            ];
          }),
        ),
      ),
      section(
        "Entry points",
        entryPoints.length === 0
          ? "none"
          : entryPoints
              .map(([label, paths]) => `- ${label}: ${paths.toSorted(byText).map(code).join(", ")}`)
              .join("\n"),
      ),
      ...partSections(directoryPart(root)),
    ),
  );

  return collisions.length > 0
    ? err(`Two pages would be written to the same path: ${[...new Set(collisions)].join(", ")}`)
    : ok(pages);
};
