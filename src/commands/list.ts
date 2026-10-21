import path from "node:path";
import { type Facts, byText, createFacts } from "../facts";
import { type Result, err, ok } from "../model";
import { type Tree, type TreeNode, ancestry, buildTree, findPart, mainSides, partNames, traySides } from "../tree";
import { parse, scan } from "./common";
import type { Io } from "./export";

export type ListOptions = { root: string; part: string; help: boolean };

export const listUsage = `Usage: laqueus list [part] [-C <dir>]

  Lists the parts of the project as JSON: sides, then areas and sub-areas.
  Pass a part to look inside it; the deepest parts list their files.
  Any listed part can be exported with "laqueus export <part>".

  part        a name from the previous list, e.g. server or server/src-lib
  -C <dir>    the project, defaults to the current working directory
  --help      show this message`;

export const parseListArgs = (argv: readonly string[], cwd: string): Result<ListOptions> => {
  const parsed = parse(argv, {
    project: { type: "string", short: "C" },
    help: { type: "boolean", short: "h", default: false },
  });

  if (!parsed.ok) return parsed;

  const { values, positionals } = parsed.value;

  if (positionals.length > 1) return err("Expected at most one part");

  return ok({ root: path.resolve(cwd, values.project ?? "."), part: positionals[0] ?? "", help: values.help });
};

const kindLabel = { root: "project", side: "side", area: "area", subarea: "sub-area", folder: "folder" };

const partsRows = (facts: Facts, names: ReadonlyMap<string, string>, nodes: readonly TreeNode[]) =>
  nodes.map((node) => {
    const stats = facts.stats(node.moduleIds);
    return {
      part: names.get(node.id) ?? "",
      label: node.label,
      kind: kindLabel[node.kind],
      files: stats.files,
      functions: stats.functions,
      maxCC: stats.maxCC,
    };
  });

const filesRows = (facts: Facts, node: TreeNode) =>
  node.moduleIds
    .flatMap((id) => facts.modules.get(id) ?? [])
    .toSorted((a, b) => byText(a.path, b.path))
    .map((module) => ({
      path: module.path,
      functions: module.metrics.functionCount,
      maxCC: module.metrics.maxCC,
      fanIn: module.metrics.fanIn,
      fanOut: module.metrics.fanOut,
    }));

const listPart = (facts: Facts, tree: Tree, names: ReadonlyMap<string, string>, node: TreeNode) => {
  const name = names.get(node.id) ?? "";
  const pathLabels = ancestry(tree, node.id).flatMap((id) => tree.nodes.get(id)?.label ?? []);
  const children = node.children.flatMap((id) => tree.nodes.get(id) ?? []);
  const main = children.filter(
    (child) => node.kind !== "root" || child.side === null || mainSides.includes(child.side),
  );
  const hidden = children.filter((child) => !main.includes(child));

  return children.length === 0
    ? {
        part: name,
        label: node.label,
        kind: kindLabel[node.kind],
        path: pathLabels,
        stats: facts.stats(node.moduleIds),
        files: filesRows(facts, node),
      }
    : {
        part: name,
        label: node.label,
        kind: kindLabel[node.kind],
        path: pathLabels,
        stats: facts.stats(node.moduleIds),
        parts: partsRows(facts, names, main),
        hidden: partsRows(facts, names, hidden),
      };
};

export const runList = async (argv: readonly string[], io: Io): Promise<number> => {
  const options = parseListArgs(argv, io.cwd);

  if (!options.ok) {
    io.log(`${options.error}\n\n${listUsage}`);
    return 1;
  }

  if (options.value.help) {
    io.out(`${listUsage}\n`);
    return 0;
  }

  const scanned = await scan(options.value.root, io.log);

  if (!scanned.ok) {
    io.log(scanned.error);
    return 1;
  }

  const tree = buildTree(scanned.value, { grouping: "areas", tray: new Set(traySides) });
  const names = partNames(tree);
  const node = options.value.part === "" ? ok(tree.root) : findPart(tree, names, options.value.part);

  if (!node.ok) {
    io.log(node.error);
    return 1;
  }

  const result = listPart(createFacts(scanned.value, null), tree, names, node.value);
  io.out(`${JSON.stringify(result, null, 2)}\n`);
  io.log(
    "files" in result
      ? `Next: laqueus export ${result.part}`
      : "Next: laqueus list <part> to look inside, laqueus export <part> to export it.",
  );
  return 0;
};
