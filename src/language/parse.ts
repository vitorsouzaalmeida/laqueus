import path from "node:path";
import { analyze as analyzeScope } from "@typescript-eslint/scope-manager";
import { parse } from "@typescript-eslint/typescript-estree";
import { visitorKeys } from "@typescript-eslint/visitor-keys";
import { type Diagnostic, type Result, err, errorMessage, ok } from "../model";
import { type Parsed, read, toPosix } from "./ast";
import { isComponent, parseSvelte } from "./svelte";

export type ParsedFile = Parsed & { path: string; absolute: string; code: string };

const errorLine = (error: unknown): number | undefined => {
  const line = read(error, "lineNumber") ?? read(error, "line") ?? read(read(error, "loc"), "line");
  return typeof line === "number" ? line : undefined;
};

const parseScript = (absolute: string, code: string): Parsed => {
  const ast = parse(code, {
    filePath: absolute,
    loc: true,
    range: true,
    comment: true,
    jsx: !absolute.endsWith(".ts"),
    jsDocParsingMode: "none",
  });

  return {
    roots: ast.body,
    template: [],
    keys: visitorKeys,
    scope: analyzeScope(ast, { sourceType: "module" }),
    comments: ast.comments ?? [],
  };
};

const closedScripts = (code: string) => code.replace(/([^\s;])([ \t]*)<\/script>/g, "$1;$2</script>");

const parseComponent = (absolute: string, code: string): { code: string; parsed: Parsed } => {
  try {
    return { code, parsed: parseSvelte(absolute, code) };
  } catch (error) {
    const closed = closedScripts(code);

    if (closed === code) throw error;

    try {
      return { code: closed, parsed: parseSvelte(absolute, closed) };
    } catch {
      throw error;
    }
  }
};

export const parseSource = (root: string, absolute: string, source: string): Result<ParsedFile, Diagnostic> => {
  const relative = toPosix(path.relative(root, absolute));
  const code = source.replace(/^\uFEFF/, "");

  try {
    const result = isComponent(absolute)
      ? parseComponent(absolute, code)
      : { code, parsed: parseScript(absolute, code) };
    return ok({ path: relative, absolute, code: result.code, ...result.parsed });
  } catch (error) {
    return err({
      file: relative,
      line: errorLine(error),
      kind: "parse-error",
      message: errorMessage(error),
    });
  }
};
