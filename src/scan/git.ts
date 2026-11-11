import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Result, err, errorMessage, ok } from "../model";

const run = promisify(execFile);

const reasonOf = (error: unknown) => {
  const lines = errorMessage(error)
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

  return (
    lines
      .find((line) => line.startsWith("fatal:"))
      ?.slice("fatal:".length)
      .trim() ??
    lines[0] ??
    "git failed"
  );
};

const git = (root: string, args: readonly string[]): Promise<Result<string>> =>
  run("git", ["-C", root, ...args], { maxBuffer: 64 * 1024 * 1024 }).then(
    ({ stdout }) => ok(stdout),
    (error: unknown) => err(reasonOf(error)),
  );

export const isCommit = (value: string) => /^[0-9a-f]{7,64}$/.test(value);

export const headCommit = async (root: string): Promise<string | null> => {
  const head = await git(root, ["rev-parse", "--verify", "HEAD"]);
  const commit = head.ok ? head.value.trim() : "";

  return isCommit(commit) ? commit : null;
};

export const renamesSince = async (root: string, commit: string): Promise<Result<Map<string, string>>> => {
  if (!isCommit(commit)) return err(`${commit} is not a commit`);

  const diff = await git(root, ["diff", "-M", "-z", "--name-status", "--relative", "--diff-filter=R", commit, "--"]);

  if (!diff.ok) return diff;

  const fields = diff.value.split("\0");

  return ok(
    new Map(
      Array.from({ length: Math.floor(fields.length / 3) }, (_, index) => {
        const from = fields[index * 3 + 1] ?? "";
        const to = fields[index * 3 + 2] ?? "";
        return [from, to] as const;
      }),
    ),
  );
};
