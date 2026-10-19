# Laqueus

The word laqueus is derived from Latin, meaning lasso/rope. This is a personal need and I'm not aiming to make it a serious open-source project. It fits only my needs and workflow. I also want it to fit how I use AI.

The idea is to build a tool to help me collect a few metrics to judge how coupled and complex a code-base is. I'm using [cyclomatic complexity](https://en.wikipedia.org/wiki/Cyclomatic_complexity), and fan-in/fan-out (how many files import a file, and how many files it imports).

For coupling I look at the import graph in a few ways:

- Cycles: I find them with [Tarjan's strongly connected components algorithm](https://en.wikipedia.org/wiki/Tarjan%27s_strongly_connected_components_algorithm). Any group of files that import each other in a loop counts as a cycle.
- Islands: these are the weakly connected components. Each island is a group of files linked by imports, with no imports from one island to another.
- Areas: these are the parts of the code-base that belong together. I find them with the [Louvain method](https://en.wikipedia.org/wiki/Louvain_method), stopped after two levels: files are grouped into sub-areas, and those into top-level areas. Imports are the main signal, and files in the same folder get a weak extra link so the folder nudges them together. Each area is named after the folder most of its files live in.
- Sides: for SvelteKit apps I walk the imports from the entry points (pages, endpoints, hooks…) to see whether each file runs on the client, the server or both. This also flags client code that imports server-only modules.
