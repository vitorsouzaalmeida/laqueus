import { farOut, widelyUsedShare } from "../graph/areas";
import { largestCut } from "../graph/cycles";
import { exactLimit } from "../graph/layers";
import { excessFrom, highFrom } from "../language/complexity";
import { shownCuts } from "./facts";

export const widelyUsedText = `Files imported by at least ${widelyUsedShare * 100}% of the files of their side and far more than the rest: their fan-in is above the side's third quartile plus ${farOut} times the interquartile range, counted as at least 1 (Tukey's far-out values). They are set aside before the areas are found and kept together here, as Bunch does with omnipresent modules (https://doi.org/10.1109/ICSM.1999.792498), so imports of them do not pull areas together.`;

export const definitions = (kit: boolean): readonly (readonly [string, string])[] => [
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
    `A file that only re-exports names from other files, with no code of its own. Barrels are not ranked by fan-in or fan-out.${kit ? " Sides follow imports as written, so a barrel still places what it re-exports, as SvelteKit loads all of it." : ""}`,
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
    kit
      ? "Where a file runs, found by walking imports that run from the SvelteKit entry points. The sides are listed in _index.md."
      : "Where a file belongs: config files are tooling, every other source file is code. The sides are listed in _index.md.",
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
    kit
      ? "A file SvelteKit loads itself (pages, layouts, endpoints, hooks…), or, outside a SvelteKit app, a file no other file imports."
      : "A file no other file imports.",
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

export const healthNotes: readonly (readonly [string, string])[] = [
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
