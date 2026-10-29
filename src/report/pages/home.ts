import type { Side } from "../../model";
import { excessFrom, highFrom } from "../../language/complexity";
import { bullets, code, factLines, page, plural, section } from "../markdown";
import type { Context } from "./context";
import { kindLabel, statsLine } from "./text";

export const homePage = (ctx: Context) => {
  const { facts, options, add, kit, scopeNode, modules, names, inPart, pageOf, trail, scopeSides } = ctx;

  const all = facts.stats(modules.map((module) => module.id));
  const scopeName = scopeNode ? (names.get(scopeNode.id) ?? "") : "";
  const scoped = scopeNode !== undefined && scopeNode.kind !== "root";
  const scopeTitle = scoped ? `${trail(scopeNode.id)} (${scopeName})` : facts.project.name;
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
  const judgementSides = facts.sides.map((info) => info.side).filter((side) => scopeSides.has(side));

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
                ["Files in scope", `${modules.length} of ${facts.moduleList.length}`],
                ["Start", code(pageOf(scopeNode.id))],
              ]),
            ),
          ]
        : []),
      section(
        "About this export",
        factLines([
          ["Project", facts.project.name],
          ["Project root", code(facts.project.root)],
          ["Framework", facts.project.framework],
          ["Scanned", facts.project.scannedAt],
          ["Scan duration", `${facts.project.durationMs} ms`],
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
          `Also: \`_areas.md\`, \`_cycles.md\`, \`_packages.md\`, ${kit ? "`_routes/_index.md`, " : ""}\`_diagnostics.md\`. What each label counts: \`_definitions.md\`.`,
        ]),
      ),
      section(
        "Sides",
        bullets(
          facts.sides
            .filter((lane) => scopeSides.has(lane.side))
            .map((lane) => {
              const sideNode = `side:${lane.side}`;
              return `${inPart(sideNode) ? code(pageOf(sideNode)) : code(lane.side)}: ${lane.label}, ${plural(facts.moduleList.filter((module) => module.placement.side === lane.side).length, "file")}. ${lane.description}`;
            }),
        ),
      ),
      section(
        "Totals",
        factLines([
          ["Files", facts.moduleList.length],
          ["Import edges", facts.totals.imports],
          ["Type-only import edges", facts.totals.typeOnlyImports],
          ["Cycles", facts.cycles.length],
          ["Areas", facts.areas.filter((area) => area.parent === null).length],
          ["Routes", facts.totals.routes],
          ["Warnings", facts.totals.warnings],
          ["Functions", facts.totals.functions],
          ["Local call edges", facts.totals.calls],
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
};
