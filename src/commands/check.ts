import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Result, err, errorMessage, ok } from "../model";
import { baselineOf, baselineSummary, checkText, compare, followRenames, parseBaseline } from "../report/check";
import { createFacts } from "../report/facts";
import { headCommit, renamesSince } from "../scan/git";
import { type Io, parse, scan } from "./common";

export type CheckOptions = { root: string; baseline: string | null; update: boolean; help: boolean };

export const defaultBaseline = ".laqueus-baseline.json";

export const checkUsage = `Usage: laqueus check [-C <dir>] [--baseline <file>] [--update]

  Compares the project with a saved baseline and lists what got worse: a new or
  bigger cycle, a new warning (a server-only import, an import that does not
  resolve), a function that entered the high CC band or rose inside it. In a git
  repository the baseline keeps its commit, and files renamed since are followed.
  Exits with 0 when nothing got worse, 1 when something did, 2 when the check
  could not run.

  -C <dir>           the project, defaults to the current working directory
  --baseline <file>  the baseline, defaults to ${defaultBaseline} in the project
  --update           save the project as it is now as the baseline
  --help             show this message`;

export const parseCheckArgs = (argv: readonly string[], cwd: string): Result<CheckOptions> => {
  const parsed = parse(argv, {
    project: { type: "string", short: "C" },
    baseline: { type: "string" },
    update: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  });

  if (!parsed.ok) return parsed;

  const { values, positionals } = parsed.value;

  if (positionals.length > 0) return err(`Unexpected argument: ${positionals[0]}`);

  return ok({
    root: path.resolve(cwd, values.project ?? "."),
    baseline: values.baseline === undefined ? null : path.resolve(cwd, values.baseline),
    update: values.update,
    help: values.help,
  });
};

const could = async <T>(action: Promise<T>): Promise<Result<T>> =>
  action.then(ok, (error: unknown) => err(errorMessage(error)));

export const runCheck = async (argv: readonly string[], io: Io): Promise<number> => {
  const options = parseCheckArgs(argv, io.cwd);

  if (!options.ok) {
    io.log(`${options.error}\n\n${checkUsage}`);
    return 2;
  }

  if (options.value.help) {
    io.out(`${checkUsage}\n`);
    return 0;
  }

  const scanned = await scan(options.value.root, io.log);

  if (!scanned.ok) {
    io.log(scanned.error);
    return 2;
  }

  const facts = createFacts(scanned.value);
  const target = options.value.baseline ?? path.join(scanned.value.root, defaultBaseline);

  if (options.value.update) {
    const baseline = baselineOf(facts, io.now().toISOString(), await headCommit(scanned.value.root));
    const written = await could(
      mkdir(path.dirname(target), { recursive: true }).then(() =>
        writeFile(target, `${JSON.stringify(baseline, null, 2)}\n`),
      ),
    );

    io.log(
      written.ok
        ? `Saved the baseline to ${target}: ${baselineSummary(baseline)}`
        : `Could not write ${target}: ${written.error}`,
    );
    return written.ok ? 0 : 2;
  }

  const text = await could(readFile(target, "utf8"));

  if (!text.ok) {
    io.log(`No baseline at ${target}. Save one with "laqueus check --update".`);
    return 2;
  }

  const baseline = parseBaseline(text.value);

  if (!baseline.ok) {
    io.log(`Cannot read the baseline at ${target}: ${baseline.error}. Save a new one with "laqueus check --update".`);
    return 2;
  }

  const { commit } = baseline.value;
  const renames = commit === null ? ok(new Map<string, string>()) : await renamesSince(scanned.value.root, commit);

  if (!renames.ok) {
    io.log(
      `Git cannot compare with the baseline's commit ${commit?.slice(0, 8)} (${renames.error}), so renamed files are not followed.`,
    );
  }

  const { baseline: current, followed } = followRenames(baseline.value, renames.ok ? renames.value : new Map());
  const comparison = compare(current, facts);

  io.out(checkText(baseline.value, comparison, followed));

  return comparison.problems.length > 0 ? 1 : 0;
};
