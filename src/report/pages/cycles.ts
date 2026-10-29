import { shownCuts } from "../facts";
import { code, factLines, nested, page, plural, section } from "../markdown";
import type { Context } from "./context";
import { cutText, edgeText, searchText, typesText } from "./text";

export const cyclesPage = (ctx: Context) => {
  const { add, filePageOf, cycles } = ctx;

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
};
