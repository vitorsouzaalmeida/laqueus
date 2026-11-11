import { realpath } from "node:fs/promises";
import path from "node:path";
import { toPosix } from "../language/ast";
import { type GraphSnapshot, type ModuleNode, type Result, err, ok } from "../model";
import { type Facts, createFacts } from "../report/facts";
import { code } from "../report/markdown";
import { fileSection } from "../report/pages/file";
import { type Tree, ancestry, buildTree, partNames } from "../scan/parts";
import { type Io, parse, scan } from "./common";

export type FileOptions = { root: string; files: string[]; logic: boolean; help: boolean };

export const fileUsage = `Usage: laqueus file <path>... [-C <dir>] [--no-logic]

  Prints what the scan knows about a file, as on its part page: where it runs,
  what imports it, what it imports, its cycle and its functions above CC 10.
  Read it before changing a file to see what the change can reach.

  path         a source file, from the current directory or from the project
  -C <dir>     the project, defaults to the current working directory
  --no-logic   leave out the per-function CC breakdown
  --help       show this message`;

export const parseFileArgs = (argv: readonly string[], cwd: string): Result<FileOptions> => {
  const parsed = parse(argv, {
    project: { type: "string", short: "C" },
    "no-logic": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  });

  if (!parsed.ok) return parsed;

  const { values, positionals } = parsed.value;

  if (positionals.length === 0 && !values.help) return err("Expected at least one file");

  return ok({
    root: path.resolve(cwd, values.project ?? "."),
    files: positionals,
    logic: !values["no-logic"],
    help: values.help,
  });
};

const candidates = async (root: string, cwd: string, file: string): Promise<string[]> => {
  const absolute = path.resolve(cwd, file);
  const real = await realpath(absolute).catch(() => absolute);

  return [real, absolute, path.resolve(root, file)].map((candidate) => toPosix(path.relative(root, candidate)));
};

const summary = (module: ModuleNode, side: string, part: string) =>
  [
    `${module.path}: ${side}`,
    `part ${part}`,
    `fan-in ${module.metrics.fanIn}`,
    `fan-out ${module.metrics.fanOut}`,
    `max CC ${module.metrics.maxCC ?? "none"}`,
    module.metrics.cycleGroup === null ? "no cycle" : `cycle #${module.metrics.cycleGroup + 1}`,
  ].join(" · ");

const fileCard = (
  data: GraphSnapshot,
  facts: Facts,
  tree: Tree,
  names: ReadonlyMap<string, string>,
  module: ModuleNode,
  logic: boolean,
) => {
  const partId = tree.pathOf.get(module.id)?.at(-1) ?? "root";
  const part = names.get(partId) ?? "";
  const trail = ancestry(tree, partId)
    .slice(1)
    .flatMap((id) => tree.nodes.get(id)?.label ?? [])
    .join(" › ");
  const side = data.sides.find((info) => info.side === module.placement.side)?.label ?? module.placement.side;

  return `${summary(module, side, part)}\n\n${fileSection(facts, module, logic, [
    ["Part", `${code(part)} (${trail})`],
    ["Side", side],
  ])}\n`;
};

export const runFile = async (argv: readonly string[], io: Io): Promise<number> => {
  const options = parseFileArgs(argv, io.cwd);

  if (!options.ok) {
    io.log(`${options.error}\n\n${fileUsage}`);
    return 1;
  }

  if (options.value.help) {
    io.out(`${fileUsage}\n`);
    return 0;
  }

  const scanned = await scan(options.value.root, io.log);

  if (!scanned.ok) {
    io.log(scanned.error);
    return 1;
  }

  const data = scanned.value;
  const facts = createFacts(data);
  const tree = buildTree(data);
  const names = partNames(tree);
  const found = await Promise.all(
    options.value.files.map(async (file) => ({
      file,
      module: (await candidates(data.root, io.cwd, file)).flatMap((id) => facts.modules.get(id) ?? [])[0],
    })),
  );
  const cards = found.flatMap(({ module }) =>
    module ? [fileCard(data, facts, tree, names, module, options.value.logic)] : [],
  );
  const missing = found.filter(({ module }) => module === undefined).map(({ file }) => file);

  io.out(cards.join("\n"));
  missing.forEach((file) =>
    io.log(
      `${file} is not in the scan. Test files, ignored files and files that are not JS, TS or Svelte are left out.`,
    ),
  );

  return missing.length === 0 ? 0 : 1;
};
