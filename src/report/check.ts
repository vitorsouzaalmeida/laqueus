import { highFrom } from "../language/complexity";
import { type Result, byText, err, ok } from "../model";
import { isCommit } from "../scan/git";
import { type CycleFacts, type DiagnosticFacts, type Facts, type FunctionFacts, groupBy } from "./facts";
import { bullets, code, oneLine, page, plural, section } from "./markdown";
import { cutText } from "./pages/text";

export type BaselineWarning = { file: string; kind: string; message: string };

export type BaselineFunction = { file: string; name: string; cc: number };

export type Baseline = {
  version: 1;
  createdAt: string;
  commit: string | null;
  cycles: string[][];
  warnings: BaselineWarning[];
  highCc: BaselineFunction[];
};

export type Comparison = { problems: string[]; fixed: string[] };

const shownFiles = 8;

const highFunctions = (facts: Facts): FunctionFacts[] =>
  facts.moduleList.flatMap((module) => facts.functionsOf(module.id)).filter((fn) => fn.ccBand === "high");

export const baselineOf = (facts: Facts, createdAt: string, commit: string | null): Baseline => ({
  version: 1,
  createdAt,
  commit,
  cycles: facts.cycles.map((cycle) => cycle.files),
  warnings: facts.diagnostics.map(({ file, kind, message }) => ({ file, kind, message })),
  highCc: highFunctions(facts)
    .map(({ file, name, cc }) => ({ file, name, cc }))
    .toSorted((a, b) => byText(a.file, b.file) || byText(a.name, b.name) || b.cc - a.cc),
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isText = (value: unknown): value is string => typeof value === "string";

const isWarning = (value: unknown): value is BaselineWarning =>
  isRecord(value) && isText(value["file"]) && isText(value["kind"]) && isText(value["message"]);

const isFunction = (value: unknown): value is BaselineFunction =>
  isRecord(value) && isText(value["file"]) && isText(value["name"]) && typeof value["cc"] === "number";

const isCycle = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

export const parseBaseline = (text: string): Result<Baseline> => {
  const value = ((): unknown => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  })();

  if (!isRecord(value)) return err("it is not a JSON object");
  if (value["version"] !== 1)
    return err(`its version is ${String(value["version"])}, and this laqueus reads version 1`);

  const { createdAt, cycles, warnings, highCc } = value;
  const commit = value["commit"] ?? null;

  if (commit !== null && !(isText(commit) && isCommit(commit))) return err("its commit is not a commit hash");

  return isText(createdAt) &&
    Array.isArray(cycles) &&
    cycles.every(isCycle) &&
    Array.isArray(warnings) &&
    warnings.every(isWarning) &&
    Array.isArray(highCc) &&
    highCc.every(isFunction)
    ? ok({ version: 1, createdAt, commit, cycles, warnings, highCc })
    : err("some of its fields are missing or have the wrong type");
};

const listed = (files: readonly string[]) =>
  files.length > shownFiles
    ? `${files.slice(0, shownFiles).map(code).join(", ")} and ${files.length - shownFiles} more`
    : files.map(code).join(", ");

const cutOf = (cycle: CycleFacts) => (cycle.cuts[0] ? ` Smallest cut: ${cutText(cycle.cuts[0])}.` : "");

const cycleChanges = (baseline: Baseline, cycles: readonly CycleFacts[]): Comparison => {
  const before = new Map(baseline.cycles.flatMap((files, index) => files.map((file) => [file, index] as const)));
  const now = new Set(cycles.flatMap((cycle) => cycle.files));

  return {
    problems: cycles.flatMap((cycle) => {
      const known = cycle.files.filter((file) => before.has(file));
      const added = cycle.files.filter((file) => !before.has(file));
      const joined = new Set(known.map((file) => before.get(file))).size;
      const size = plural(cycle.files.length, "file");

      if (known.length === 0) return [`New cycle of ${size}: ${listed(cycle.files)}.${cutOf(cycle)}`];
      if (added.length > 0) return [`Cycle grew to ${size}: ${listed(added)} joined ${listed(known)}.${cutOf(cycle)}`];

      return joined > 1 ? [`${joined} cycles became one of ${size}: ${listed(cycle.files)}.${cutOf(cycle)}`] : [];
    }),
    fixed: baseline.cycles.flatMap((files) => {
      const left = files.filter((file) => now.has(file));
      const gone = files.filter((file) => !now.has(file));

      if (left.length === 0) return [`Cycle gone: ${listed(files)}.`];

      return gone.length > 0 ? [`Cycle smaller: ${listed(gone)} left the cycle of ${listed(left)}.`] : [];
    }),
  };
};

const warningKey = (warning: BaselineWarning) => `${warning.file}\u0000${warning.kind}\u0000${warning.message}`;

const warningChanges = (baseline: Baseline, warnings: readonly DiagnosticFacts[]): Comparison => {
  const before = new Set(baseline.warnings.map(warningKey));
  const now = new Set(warnings.map(warningKey));

  return {
    problems: warnings
      .filter((warning) => !before.has(warningKey(warning)))
      .map(
        (warning) =>
          `New warning: ${code(warning.file)} line ${warning.line ?? "none"}, ${warning.kind}: ${oneLine(warning.message)}`,
      ),
    fixed: baseline.warnings
      .filter((warning) => !now.has(warningKey(warning)))
      .map((warning) => `Warning gone: ${code(warning.file)}, ${warning.kind}: ${oneLine(warning.message)}`),
  };
};

const functionKey = (fn: BaselineFunction) => `${fn.file}\u0000${fn.name}`;

const byFunction = <T extends BaselineFunction>(functions: readonly T[]) =>
  new Map([...groupBy(functions, functionKey)].map(([key, same]) => [key, same.toSorted((a, b) => b.cc - a.cc)]));

const where = (fn: BaselineFunction) => `${code(fn.name)} in ${code(fn.file)}`;

const complexityChanges = (baseline: Baseline, functions: readonly FunctionFacts[]): Comparison => {
  const before = byFunction(baseline.highCc);
  const now = byFunction(functions);
  return {
    problems: [...now].flatMap(([key, same]) =>
      same.flatMap((fn, index) => {
        const was = before.get(key)?.[index]?.cc;

        if (was === undefined) {
          return [`High CC: ${where(fn)} (line ${fn.line}) is CC ${fn.cc}, new in the high band (${highFrom}+).`];
        }

        return fn.cc > was ? [`High CC: ${where(fn)} (line ${fn.line}) is CC ${fn.cc}, was ${was}.`] : [];
      }),
    ),
    fixed: [...before].flatMap(([key, same]) =>
      same.flatMap((fn, index) => {
        const is = now.get(key)?.[index]?.cc;

        if (is === undefined) return [`CC lower: ${where(fn)} left the high band, was ${fn.cc}.`];

        return is < fn.cc ? [`CC lower: ${where(fn)} is CC ${is}, was ${fn.cc}.`] : [];
      }),
    ),
  };
};

export const followRenames = (
  baseline: Baseline,
  renames: ReadonlyMap<string, string>,
): { baseline: Baseline; followed: number } => {
  const now = (file: string) => renames.get(file) ?? file;
  const known = new Set([
    ...baseline.cycles.flat(),
    ...baseline.warnings.map((warning) => warning.file),
    ...baseline.highCc.map((fn) => fn.file),
  ]);

  return {
    baseline: {
      ...baseline,
      cycles: baseline.cycles.map((files) => files.map(now).toSorted(byText)),
      warnings: baseline.warnings.map((warning) => ({ ...warning, file: now(warning.file) })),
      highCc: baseline.highCc.map((fn) => ({ ...fn, file: now(fn.file) })),
    },
    followed: [...renames.keys()].filter((file) => known.has(file)).length,
  };
};

export const compare = (baseline: Baseline, facts: Facts): Comparison => {
  const parts = [
    cycleChanges(baseline, facts.cycles),
    warningChanges(baseline, facts.diagnostics),
    complexityChanges(baseline, highFunctions(facts)),
  ];

  return { problems: parts.flatMap((part) => part.problems), fixed: parts.flatMap((part) => part.fixed) };
};

export const baselineSummary = (baseline: Baseline) =>
  [
    plural(baseline.cycles.length, "cycle"),
    plural(baseline.warnings.length, "warning"),
    `${plural(baseline.highCc.length, "function")} in the high CC band`,
  ].join(", ");

export const checkText = (baseline: Baseline, comparison: Comparison, followed: number) =>
  page(
    [
      `Check: ${plural(comparison.problems.length, "new problem")}`,
      `${comparison.fixed.length} fixed`,
      `against the baseline of ${baseline.createdAt}${baseline.commit === null ? "" : ` at ${baseline.commit.slice(0, 8)}`}`,
      ...(followed === 0 ? [] : [`${plural(followed, "renamed file")} followed`]),
    ].join(", "),
    "Check",
    section("New problems", bullets(comparison.problems)),
    section(
      "Fixed since the baseline",
      comparison.fixed.length === 0
        ? "none"
        : `${bullets(comparison.fixed)}\n\nKeep these with \`laqueus check --update\`.`,
    ),
  );
