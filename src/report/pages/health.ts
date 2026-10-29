import { healthNotes } from "../prose";
import { bullets, factLines, page, percent, plural, section } from "../markdown";
import type { Context } from "./context";
import { shareText } from "./text";

export const healthPage = (ctx: Context) => {
  const { facts, add, sideLabel, scopeSides } = ctx;

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
};
