# Laqueus

The word laqueus is derived from Latin, meaning lasso/rope. This is a personal need and I'm not aiming to make it a serious open-source project. It fits only my needs and workflow. I also want it to fit how I use AI.

The idea is to build a tool to help me collect a few metrics to judge how coupled and complex a code-base is. I'm using [cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity), and fan-in/fan-out (how many files import a file, and how many files it imports).

For coupling I look at the import graph in a few ways:

- Cycles: I find them with [Tarjan's strongly connected components algorithm](https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm). Any group of files that import each other in a loop counts as a cycle.
- Islands: these are the weakly connected components. Each island is a group of files linked by imports, with no imports from one island to another.
- Areas: these are the parts of the code-base that belong together. I find them with the [Louvain method](https://en.wikipedia.org/wiki/Louvain_method), stopped after two levels: files are grouped into sub-areas, and those into top-level areas. Imports are the main signal, and files in the same folder get a weak extra link so the folder nudges them together. Each area is named after the folder most of its files live in.
- Sides: for SvelteKit apps I walk the imports from the entry points (pages, endpoints, hooks…) to see whether each file runs on the client, the server or both. This also flags client code that imports server-only modules.

## Export

`laqueus export` writes every metric the viewer shows as a directory of small Markdown pages. It measures, and also classifies: each metric gets a band (low, moderate, high…) so a reader can skip what is normal and focus on outliers.

```sh
laqueus export                  # the whole project, into .laqueus/
laqueus export --no-logic       # leave out the per-function CC breakdown
laqueus export -C ../app -o ctx # another project, another directory
```

To export one part, find it with `list`, which prints the parts as JSON the way the viewer groups them (sides, then areas and sub-areas), and drill down until you have the part you want:

```sh
laqueus list                    # client, shared, server…
laqueus list server             # the areas inside server: server/src-lib, …
laqueus list server/src-lib     # deeper, or the files of the deepest parts
laqueus export server           # only that part, into .laqueus-server/
```

A part export has the same pages, limited to the part's files, and its numbers are still measured against the whole project.

The directory mirrors the source tree:

- `X.md` is the page for source file `X`: side, area, reach, fan-in/out, cycle, imports with lines, and each function's CC with the decisions that add to it.
- Every source directory has an `_index.md`: its entries with their numbers, imports between them and imports crossing the directory.
- Names starting with `_` are generated: `_index.md` (start here), `_map/` (the viewer's sides and areas, with the same names `list` uses), `_cycles.md`, `_routes/`, `_packages.md`, `_diagnostics.md`, `_definitions.md`.
- The first line of every page is a one-line summary, so `head -qn1 src/*/_index.md` scans a level. Facts are `- Label: value` lines, so `grep -rl "Cycle: #2" .laqueus` finds the files of a cycle.

The export is a snapshot: the start page records when the project was scanned and exported, and every other page is the same for the same code. Each export replaces the directory, and it refuses to replace a directory it did not write. To point an agent at it, add a line like this to `CLAUDE.md` or `AGENTS.md`:

> Code metrics snapshot in `.laqueus/`: start at `.laqueus/_index.md`; the page for source file X is `.laqueus/X.md`.

## Judgement

The raw numbers are useful, but I also want the export to tell me what stands out. Each metric gets a band (low, moderate, high…) so a reader can skip what is normal and look at the outliers. I use three approaches:

- Complexity bands are fixed: low (1–10), moderate (11–15), high (16+). These come from [cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity) research going back to McCabe's original paper.
- Fan-in and fan-out bands come from each project's own distribution. There is no universal number for "high fan-out". I sort all files by fan-in (or fan-out) and use the percentile rank: below the 75th percentile is low, 75th–89th is moderate, 90th–94th is high, 95th and above is extreme. A file in the top quartile of both fan-in and fan-out is flagged as a hub: it depends on many files and many files depend on it, making it the hardest kind of file to change.
- Cycle severity is based on how many files are in the cycle: up to 2 is minor, 3–5 is moderate, 6 or more is severe. Larger cycles are harder to break. Density (edges inside the cycle divided by the maximum possible) says how tangled it is: a simple ring is low density, a cluster where everyone imports everyone is high.

Every band appears as a `- Label: value` line in the Markdown, and `_definitions.md` explains how each one is computed.
