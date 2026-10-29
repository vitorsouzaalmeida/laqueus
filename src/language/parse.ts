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
    jsx: !absolute.endsWith(".ts"),
    jsDocParsingMode: "none",
  });

  return { roots: ast.body, template: [], keys: visitorKeys, scope: analyzeScope(ast, { sourceType: "module" }) };
};

export const parseSource = (root: string, absolute: string, code: string): Result<ParsedFile, Diagnostic> => {
  const relative = toPosix(path.relative(root, absolute));

  try {
    const parsed = isComponent(absolute) ? parseSvelte(absolute, code) : parseScript(absolute, code);
    return ok({ path: relative, absolute, code, ...parsed });
  } catch (error) {
    return err({
      file: relative,
      line: errorLine(error),
      kind: "parse-error",
      message: errorMessage(error),
    });
  }
};
