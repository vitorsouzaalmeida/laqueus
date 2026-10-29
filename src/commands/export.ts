import path from "node:path";
import { type Result, err, ok } from "../model";
import { createFacts } from "../report/facts";
import { buildPages } from "../report/pages/index";
import { writeContext } from "../report/write";
import { buildTree, findPart, partNames } from "../scan/parts";
import { type Io, parse, scan } from "./common";

export type ExportOptions = { root: string; part: string; output: string | null; logic: boolean; help: boolean };

export const defaultOutput = ".laqueus";

export const exportUsage = `Usage: laqueus export [part] [-C <dir>] [-o <dir>] [--no-logic]

  Writes the project's metrics as a directory of Markdown pages an AI agent can
  navigate: one folder per side and one page per area, sub-area or folder, named
  like the parts of "laqueus list", with _files.md mapping every source file to
  its page. Test files are not scanned. The directory is replaced each time.

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
  const tree = buildTree(data);
  const scope = part === "" ? ok(tree.root) : findPart(tree, partNames(tree), part);

  if (!scope.ok) {
    io.log(`${scope.error} Run "laqueus list" to see the parts.`);
    return 1;
  }

  const pages = buildPages(createFacts(data), tree, {
    exportedAt: io.now().toISOString(),
    logic: options.value.logic,
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
