import { byText, type ModuleNode } from "../model";
import { highFrom } from "../language/complexity";
import { type CycleFacts, type Facts, holdsInside } from "./facts";

export const shownHigh = 50;
export const shownTop = 20;

export const pairsOf = (module: ModuleNode) => module.metrics.visibilityFanIn * module.metrics.visibilityFanOut;

export const findings = (facts: Facts, modules: readonly ModuleNode[], cycles: readonly CycleFacts[]) => {
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
  const through = modules
    .filter((module) => pairsOf(module) > 1)
    .toSorted((a, b) => pairsOf(b) - pairsOf(a) || byText(a.path, b.path));
  const findingCycles = cycles.toSorted((a, b) => b.reach.pairs - a.reach.pairs || a.number - b.number);
  const barrels = modules.filter((module) => module.barrel).map((module) => module.path);

  return { high, heldInside, bigClasses, excess, through, findingCycles, barrels };
};
