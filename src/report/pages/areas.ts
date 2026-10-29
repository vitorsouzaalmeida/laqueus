import { bullets, nested, page, percent, plural, ratioText, section, subsection } from "../markdown";
import type { Context } from "./context";

export const areasPage = (ctx: Context) => {
  const { facts, add, sideLabel, areaName, areaPage, layerLines, scopeAreas, touchesArea, layerSides } = ctx;

  add(
    "_areas.md",
    page(
      `Areas: ${[
        plural(facts.areas.filter((area) => area.parent === null && scopeAreas.has(area.id)).length, "area"),
        ...layerSides.map((layers) => `${layers.side} ${percent(layers.back.length, layers.between)} pointing back`),
      ].join(" · ")}`,
      "Areas",
      "Areas are found within each side, so every number here is about imports between files of the same side.",
      ...[...new Set(facts.areas.filter((area) => scopeAreas.has(area.id)).map((area) => area.side))].map((side) => {
        const layers = facts.layers.find((entry) => entry.side === side);
        const top = facts.areas.filter((area) => area.side === side && area.parent === null && scopeAreas.has(area.id));
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
                  const subs = facts.areas.filter((sub) => sub.parent === area.id);
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
};
