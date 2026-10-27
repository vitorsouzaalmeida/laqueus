# Laqueus

Laqueus is Latin for lasso, or snare. It's a personal tool, built for my own needs and workflow, not a serious open-source project.

It measures how complex and how coupled a codebase is, and exports the results as Markdown. It reads TypeScript, JavaScript, and Sveltekit apps.

- Side: for SvelteKit apps, where a file runs: client, server, or shared by both.
- Area: a group of files that belong together, found from their imports. Big areas are split into sub-areas.
- Part: a side, area, sub-area or folder. `list` and `export` group files the same way.

## What it measures

- Complexity: [cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity) counts the branches of a function: if, loops, catch, case, ternaries, && and ||.
- Fan-in and fan-out: how many files import a file, and how many files it imports. Test files are not scanned. When a file only re-exports a name, like an `index.ts`, the import counts against the file that declares the name, so the index doesn't look like the center of the codebase.
- Visibility: how many files a file reaches through imports, directly or through others, and how many reach it ([MacCormack, Rusnak and Baldwin](https://doi.org/10.1287/mnsc.1060.0552)). Files that sit between many others are the ones I want to know about first.
- Cycles: groups of files that import each other in a loop, found with [Tarjan's algorithm](https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm). For each cycle I look for the fewest imports that would break it.
- Areas: files grouped by their imports with the [Louvain method](https://en.wikipedia.org/wiki/Louvain_method), and named after the folder most of their files live in. Files used almost everywhere are set aside first, as [Bunch](https://doi.org/10.1109/ICSM.1999.792498) does, so they don't pull every area together.
- Sides: I follow the imports from the entry points of a SvelteKit app (pages, endpoints, hooks…) to see where each file runs. This also flags client code that imports server-only modules.

## Export

`laqueus export` writes every metric as a directory of small Markdown pages, easy to grep and for an agent to read.

```sh
laqueus export                  # the whole project, into .laqueus/
laqueus export --no-logic       # leave out the per-function complexity
laqueus export -C ../app -o ctx # another project, another directory
```

To export one part, find it with `list` and drill down:

```sh
laqueus list                    # client, shared, server…
laqueus list server             # the areas inside server: server/src-lib, …
laqueus export server           # only that part, into .laqueus-server/
```

## Judgement

Some metrics get a band (low, moderate, high…):

- Complexity bands: low (1–10), moderate (11–15), high (16+). These come from cyclomatic complexity research going back to McCabe's original paper.
- Fan-in and fan-out bands come from each project's own numbers. I rank the files within their side: below the 75th percentile is low, 75th–89th is moderate, 90th–94th is high, 95th and above is extreme.
- Cycle severity is based on how many files are in the cycle: 2 is minor, 3–5 is moderate, 6 or more is severe. Next to it I show how many imports it takes to break it, which is the cost of fixing it.
- The health page sums up each side with plain numbers and no verdict.
