import path from "node:path";
import { fileLogic } from "../analyze";
import { buildPages } from "../context/pages";
import { writeContext } from "../context/write";
import { createFacts } from "../facts";
import { type FunctionLogic, type GraphSnapshot, type Result, err, ok } from "../model";
import { buildTree, findPart, partNames, traySides } from "../tree";
import { parse, scan } from "./common";

export type Io = {
  cwd: string;
  out: (text: string) => void;
  log: (line: string) => void;
  now: () => Date;
};

export type ExportOptions = { root: string; part: string; output: string | null; logic: boolean; help: boolean };

export const defaultOutput = ".laqueus";

export const exportUsage = `Usage: laqueus export [part] [-C <dir>] [-o <dir>] [--no-logic]

  Writes the project's metrics as a directory of Markdown pages an AI agent can
  navigate: one page per source file, one _index.md per source directory, and
  _map/ with the viewer's sides and areas. The directory is replaced each time.

  part         a part from "laqueus list", e.g. server; defaults to the whole project
  -C <dir>     the project, defaults to the current working directory
  -o <dir>     where to write, defaults to ${defaultOutput} (or ${defaultOutput}-<part>) in the project
  --no-logic   leave out the per-function CC breakdown
  --help       show this message`;

export const outputFor = (root: string, part: string) =>
  path.join(root, part === "" ? defaultOutput : `${defaultOutput}-${part.replaceAll("/", "-")}`);

export const parseExportArgs = (argv: readonly string[], cwd: string): Result<ExportOptions> => {
  const parsed = parse(argv, {
    project: { type: "string", short: "C" },
    "no-logic": { type: "boolean", default: false },
    output: { type: "string", short: "o" },
    help: { type: "boolean", short: "h", default: false },
  });

  if (!parsed.ok) return parsed;

  const { values, positionals } = parsed.value;

  if (positionals.length > 1) return err("Expected at most one part");

  return ok({
    root: path.resolve(cwd, values.project ?? "."),
    part: (positionals[0] ?? "").replace(/^\/+|\/+$/g, ""),
    output: values.output === undefined ? null : path.resolve(cwd, values.output),
    logic: !values["no-logic"],
    help: values.help,
  });
};

const logicFor = async (data: GraphSnapshot, moduleIds: ReadonlySet<string>) => {
  const files = [...new Set(data.functions.filter((fn) => moduleIds.has(fn.moduleId)).map((fn) => fn.location.file))];
  const results = await Promise.all(files.map((file) => fileLogic(data, file)));

  return new Map<string, FunctionLogic>(results.flatMap((result) => (result.ok ? [...result.value] : [])));
};

export const runExport = async (argv: readonly string[], io: Io): Promise<number> => {
  const options = parseExportArgs(argv, io.cwd);

  if (!options.ok) {
    io.log(`${options.error}\n\n${exportUsage}`);
    return 1;
  }

  if (options.value.help) {
    io.out(`${exportUsage}\n`);
    return 0;
  }

  const scanned = await scan(options.value.root, io.log);

  if (!scanned.ok) {
    io.log(scanned.error);
    return 1;
  }

  const data = scanned.value;
  const { part } = options.value;
  const tree = buildTree(data, { grouping: "areas", tray: new Set(traySides) });
  const scope = part === "" ? ok(tree.root) : findPart(tree, partNames(tree), part);

  if (!scope.ok) {
    io.log(`${scope.error} Run "laqueus list" to see the parts.`);
    return 1;
  }

  const logic = options.value.logic ? await logicFor(data, new Set(scope.value.moduleIds)) : null;
  const pages = buildPages(createFacts(data, logic), tree, {
    exportedAt: io.now().toISOString(),
    ...(part === "" ? {} : { scope: scope.value.id }),
  });

  if (!pages.ok) {
    io.log(pages.error);
    return 1;
  }

  const written = await writeContext(options.value.output ?? outputFor(options.value.root, part), pages.value);

  if (!written.ok) {
    io.log(written.error);
    return 1;
  }

  const fromRoot = path.relative(options.value.root, written.value);
  const shown = fromRoot.startsWith("..") || path.isAbsolute(fromRoot) ? written.value : fromRoot;

  io.log(`Wrote ${pages.value.size} pages to ${written.value}`);
  io.log(`start at ${shown}/_index.md`);

  return 0;
};
