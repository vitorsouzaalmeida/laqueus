import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { toPosix } from "../language/ast";

const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".svelte"]);
const excludedDirectories = new Set([
  ".git",
  "node_modules",
  ".svelte-kit",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".vercel",
  ".netlify",
  ".next",
  ".nuxt",
  ".output",
  ".wrangler",
  ".cache",
]);
const excludedFileSuffixes = [".d.ts", ".min.js"];

type IgnoreRule = { base: string; matcher: Ignore };

const isSourceFile = (name: string) =>
  sourceExtensions.has(path.extname(name)) && !excludedFileSuffixes.some((suffix) => name.endsWith(suffix));

const gitignoreRules = async (dir: string): Promise<IgnoreRule[]> =>
  readFile(path.join(dir, ".gitignore"), "utf8").then(
    (content) => [{ base: dir, matcher: ignore().add(content) }],
    () => [],
  );

const isIgnored = (rules: readonly IgnoreRule[], absolute: string, isDirectory: boolean) =>
  rules.some((rule) => {
    const relative = toPosix(path.relative(rule.base, absolute));
    return relative !== "" && rule.matcher.ignores(isDirectory ? `${relative}/` : relative);
  });

const walk = async (dir: string, inherited: readonly IgnoreRule[]): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const rules = [...inherited, ...(await gitignoreRules(dir))];
  const nested = await Promise.all(
    entries.map(async (entry): Promise<string[]> => {
      const absolute = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        return excludedDirectories.has(entry.name) || isIgnored(rules, absolute, true) ? [] : walk(absolute, rules);
      }

      return entry.isFile() && isSourceFile(entry.name) && !isIgnored(rules, absolute, false) ? [absolute] : [];
    }),
  );

  return nested.flat();
};

export const discoverSourceFiles = async (root: string): Promise<string[]> => (await walk(root, [])).toSorted();

const testPatterns = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.stories\.([cm]?[jt]sx?|svelte)$/,
  /(^|\/)(__tests__|__mocks__|__fixtures__|e2e|tests?)\//,
];
export const configPattern = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;

export const isTest = (file: string) => testPatterns.some((pattern) => pattern.test(file));
