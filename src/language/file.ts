import type { Scope, ScopeManager, Variable } from "@typescript-eslint/scope-manager";
import type { TSESTree } from "@typescript-eslint/types";
import {
  type CallEdge,
  type ClassNode,
  type Diagnostic,
  type FunctionNode,
  type Result,
  classId,
  err,
  errorMessage,
  functionId,
  ok,
} from "../model";
import { type FunctionLike, indexTree, isFunction, locationOf } from "./ast";
import type { ExportTable } from "./barrels";
import { resolveLocalCalls } from "./calls";
import {
  branchComplexity,
  cyclomaticComplexity,
  inclusiveComplexity,
  isOwnershipBoundary,
  measureTemplate,
  ownNodes,
} from "./complexity";
import { functionDecisions, markupDecisions, waysOut } from "./decisions";
import { extractExports } from "./exports";
import { type ImportReference, extractImports } from "./imports";
import { functionNamer } from "./names";
import { type ParsedFile, parseSource } from "./parse";
import { isComponent, isSnippet, moduleName, scriptName, templateName } from "./svelte";

export type FileAnalysis = {
  path: string;
  imports: ImportReference[];
  exports: ExportTable;
  functions: FunctionNode[];
  classes: ClassNode[];
  calls: CallEdge[];
};

const declaredVariable = (variable: Variable) =>
  variable.defs.some(
    (def) =>
      def.type === "Parameter" ||
      (def.type === "Variable" && def.parent.type === "VariableDeclaration" && def.parent.kind !== "const"),
  );

const scopesByHome = (scope: ScopeManager) =>
  scope.scopes.reduce((map, candidate) => {
    const known = map.get(candidate.variableScope);

    if (known) known.push(candidate);
    else map.set(candidate.variableScope, [candidate]);

    return map;
  }, new Map<Scope, Scope[]>());

const outerWrites = (fn: FunctionLike, scope: ScopeManager, homes: ReadonlyMap<Scope, readonly Scope[]>): number => {
  const own = scope.acquire(fn, true);

  if (!own) return 0;

  const home = own.variableScope;
  const declared = (homes.get(home) ?? []).flatMap((candidate) => candidate.variables.filter(declaredVariable));

  return declared.filter((variable) =>
    variable.references.some(
      (reference) => reference.isWrite() && !reference.init && reference.from.variableScope !== home,
    ),
  ).length;
};

const isClass = (node: TSESTree.Node): node is TSESTree.ClassDeclaration | TSESTree.ClassExpression =>
  node.type === "ClassDeclaration" || node.type === "ClassExpression";

const byPosition = (a: FunctionNode, b: FunctionNode) =>
  a.location.line - b.location.line || a.location.column - b.location.column;

export const analyzeParsedFile = (file: ParsedFile): FileAnalysis => {
  const { nodes, parents } = indexTree([...file.roots, ...file.template], file.keys);
  const namer = functionNamer(parents, new Set(file.template));
  const functions = nodes.filter(isFunction);
  const ids = new Map<FunctionLike, string>();
  const lines = file.code.split("\n");
  const homes = scopesByHome(file.scope);
  const ownedBy = (roots: readonly TSESTree.Node[]) =>
    roots.flatMap((root) => (isOwnershipBoundary(root) ? [] : [root, ...ownNodes(root, file.keys)]));

  const real = functions.map((fn): FunctionNode => {
    const location = locationOf(fn, file.path);
    const id = functionId(location);

    ids.set(fn, id);

    return {
      id,
      moduleId: file.path,
      name: namer.nameFor(fn),
      location,
      complexity: cyclomaticComplexity(fn, file.keys),
      branches: branchComplexity(fn, file.keys),
      inclusive: inclusiveComplexity(fn, file.keys),
      outerWrites: outerWrites(fn, file.scope, homes),
      decisions: functionDecisions(fn, ownNodes(fn, file.keys), parents, lines),
      waysOut: waysOut(fn),
    };
  });
  const snippets = nodes.filter(isSnippet).map((snippet): FunctionNode => {
    const location = locationOf(snippet, file.path);
    return {
      id: functionId(location),
      moduleId: file.path,
      name: namer.nameFor(snippet),
      location,
      complexity: cyclomaticComplexity(snippet, file.keys),
      branches: branchComplexity(snippet, file.keys),
      inclusive: inclusiveComplexity(snippet, file.keys),
      outerWrites: 0,
      decisions: markupDecisions(ownNodes(snippet, file.keys), lines),
      waysOut: 1,
    };
  });
  const [first] = file.template;
  const markupNodes = ownedBy(file.template);
  const markup: FunctionNode[] = first
    ? [
        {
          id: `${functionId(locationOf(first, file.path))}:template`,
          moduleId: file.path,
          name: templateName,
          location: locationOf(first, file.path),
          ...measureTemplate(file.template, file.keys),
          outerWrites: 0,
          decisions: markupDecisions(markupNodes, lines),
          waysOut: 1,
        },
      ]
    : [];
  const [firstRoot] = file.roots;
  const topNodes = ownedBy(file.roots);
  const top = measureTemplate(file.roots, file.keys);
  const component = isComponent(file.path);
  const topLevel: FunctionNode[] =
    firstRoot && top.complexity > 1
      ? [
          {
            id: `${functionId(locationOf(firstRoot, file.path))}:${component ? "script" : "module"}`,
            moduleId: file.path,
            name: component ? scriptName : moduleName,
            location: locationOf(firstRoot, file.path),
            complexity: top.complexity,
            branches: top.branches,
            inclusive: top.complexity,
            outerWrites: 0,
            decisions: functionDecisions(null, topNodes, parents, lines),
            waysOut: 1,
          },
        ]
      : [];
  const classes = nodes.filter(isClass).map((cls): ClassNode => {
    const location = locationOf(cls, file.path);
    return {
      id: classId(location),
      moduleId: file.path,
      name: namer.classLabel(cls),
      location,
      inclusive: inclusiveComplexity(cls.body, file.keys),
    };
  });

  return {
    path: file.path,
    imports: extractImports(file, nodes),
    exports: extractExports(file),
    functions: [...real, ...topLevel, ...markup, ...snippets].toSorted(byPosition),
    classes,
    calls: resolveLocalCalls(functions, {
      file: file.path,
      keys: file.keys,
      parents,
      scope: file.scope,
      functionIds: ids,
    }),
  };
};

export const analyzeSource = (root: string, absolute: string, code: string): Result<FileAnalysis, Diagnostic> => {
  const parsed = parseSource(root, absolute, code);

  if (!parsed.ok) return parsed;

  try {
    return ok(analyzeParsedFile(parsed.value));
  } catch (error) {
    return err({
      file: parsed.value.path,
      kind: "unsupported-syntax",
      message: `Analysis failed: ${errorMessage(error)}`,
    });
  }
};
