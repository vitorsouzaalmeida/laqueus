import * as tsParser from "@typescript-eslint/parser";
import type { ScopeManager } from "@typescript-eslint/scope-manager";
import type { TSESTree } from "@typescript-eslint/types";
import * as svelteParser from "svelte-eslint-parser";
import { type Parents, type Parsed, read } from "./ast";

export const templateName = "<template>";

export const templateBranches = new Set([
  "SvelteIfBlock",
  "SvelteEachBlock",
  "SvelteAwaitBlock",
  "SvelteAwaitCatchBlock",
]);

export const snippetBlock = "SvelteSnippetBlock";

export const markupLoops = new Set(["SvelteEachBlock"]);

export const markupCatches = new Set(["SvelteAwaitCatchBlock"]);

export const isComponent = (file: string) => file.endsWith(".svelte");

export const isSnippet = (node: unknown) => read(node, "type") === snippetBlock;

const isMarkup = (node: unknown) => {
  const type = read(node, "type");
  const value = read(node, "value");

  return (
    type !== "SvelteScriptElement" &&
    type !== "SvelteStyleElement" &&
    type !== "SvelteHTMLComment" &&
    !(type === "SvelteText" && typeof value === "string" && value.trim() === "")
  );
};

export const parseSvelte = (absolute: string, code: string): Parsed => {
  const output = svelteParser.parseForESLint(code, {
    parser: tsParser,
    filePath: absolute,
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const scripts = output.ast.body.flatMap((node) => (node.type === "SvelteScriptElement" ? node.body : []));
  const markup = output.ast.body.filter(isMarkup);

  // svelte-eslint-parser declares plain ESTree and ESLint scope types, but with `parser: tsParser`
  // the script contents and their scope come from typescript-eslint.
  return {
    roots: scripts as unknown as TSESTree.ProgramStatement[],
    template: markup as unknown as TSESTree.Node[],
    keys: output.visitorKeys,
    scope: output.scopeManager as unknown as ScopeManager,
  };
};

const directivePrefixes: Readonly<Record<string, string>> = {
  EventHandler: "on",
  Binding: "bind",
  Class: "class",
  Action: "use",
  Transition: "transition",
  Animation: "animate",
  Let: "let",
};

export const markupLabel = (holder: TSESTree.Node, parents: Parents): string | undefined => {
  const parent = parents.get(holder);
  const type = read(parent, "type");

  if (type === "SvelteDirective" && read(parent, "expression") === holder) {
    const kind = read(parent, "kind");
    const name = read(read(read(parent, "key"), "name"), "name");
    const prefix = typeof kind === "string" ? (directivePrefixes[kind] ?? kind.toLowerCase()) : "directive";

    return typeof name === "string" ? `${prefix}:${name}` : undefined;
  }

  const attribute = type === "SvelteMustacheTag" && parent ? parents.get(parent) : undefined;
  const name = read(read(attribute, "key"), "name");

  return read(attribute, "type") === "SvelteAttribute" && typeof name === "string" ? name : undefined;
};
