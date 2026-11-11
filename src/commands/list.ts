import path from "node:path";
import { type GraphSnapshot, type Result, byText, err, ok } from "../model";
import { type Tree, type TreeNode, buildTree, findPart, partNames } from "../scan/parts";
import { type Io, parse, scan } from "./common";

export type ListOptions = { root: string; part: string; help: boolean };

export const listUsage = `Usage: laqueus list [part] [-C <dir>]

  Lists the parts of the project, one per line: sides, then areas and sub-areas.
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

const listPart = (data: GraphSnapshot, tree: Tree, names: ReadonlyMap<string, string>, node: TreeNode) => {
  const byArea = new Set(data.sides.filter((info) => info.grouping === "areas").map((info) => info.side));
  const children = node.children.flatMap((id) => tree.nodes.get(id) ?? []);
  const main = children.filter((child) => node.kind !== "root" || child.side === null || byArea.has(child.side));
  const hidden = children.filter((child) => !main.includes(child));

  if (children.length > 0) return [...main, ...hidden].map((child) => names.get(child.id) ?? "");

  const paths = new Map(data.modules.map((module) => [module.id, module.path]));
  return node.moduleIds.flatMap((id) => paths.get(id) ?? []).toSorted(byText);
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

  const tree = buildTree(scanned.value);
  const names = partNames(tree);
  const node = options.value.part === "" ? ok(tree.root) : findPart(tree, names, options.value.part);

  if (!node.ok) {
    io.log(node.error);
    return 1;
  }

  const lines = listPart(scanned.value, tree, names, node.value);
  io.out(lines.length === 0 ? "" : `${lines.join("\n")}\n`);
  io.log(
    node.value.children.length === 0
      ? `Next: laqueus export ${names.get(node.value.id) ?? ""}`
      : "Next: laqueus list <part> to look inside, laqueus export <part> to export it.",
  );
  return 0;
};
