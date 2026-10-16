import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as tsParser from "@typescript-eslint/parser";
import ignore, { type Ignore } from "ignore";
import * as svelteParser from "svelte-eslint-parser";
import {
  type AstNode,
  type VisitorKeys,
  descendants,
  field,
  isFunction,
  locationOf,
  outerOfWrappers,
  parentMap,
  stringField,
} from "./ast";
import { type ScopeManagerLike, resolveLocalCalls } from "./calls";
import { detectAreas } from "./areas";
import { buildLogic } from "./logic";
import { cyclomaticComplexity, moduleMetrics } from "./metrics";
import {
  type CallEdge,
  type DependencyEdge,
  type Diagnostic,
  type FunctionLogic,
  type FunctionNode,
  type GraphSnapshot,
  type Location,
  type Result,
  err,
  functionId,
  moduleId,
  ok,
} from "./model";
import { createResolver } from "./resolve";
import { buildStructure, findSvelteKitApps } from "./structure";

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

export type ParsedFile = {
  path: string;
  absolute: string;
  roots: AstNode[];
  keys: VisitorKeys;
  scope: ScopeManagerLike;
};

type ImportReference = { specifier: string; location: Location };

type FileAnalysis = {
  path: string;
  imports: ImportReference[];
  functions: FunctionNode[];
  calls: CallEdge[];
};

const toPosix = (value: string) => value.split(path.sep).join("/");

const isSourceFile = (name: string) =>
  sourceExtensions.has(path.extname(name)) &&
  !excludedFileSuffixes.some((suffix) => name.endsWith(suffix));

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
        return excludedDirectories.has(entry.name) || isIgnored(rules, absolute, true)
          ? []
          : walk(absolute, rules);
      }
      return entry.isFile() && isSourceFile(entry.name) && !isIgnored(rules, absolute, false)
        ? [absolute]
        : [];
    }),
  );
  return nested.flat();
};

export const discoverSourceFiles = async (root: string): Promise<string[]> =>
  (await walk(root, [])).sort();

type ParserOutput = { ast: unknown; scopeManager: unknown; visitorKeys: unknown };

const errorLine = (error: unknown): number | undefined => {
  const candidate = error as { lineNumber?: unknown; line?: unknown; loc?: { line?: unknown } };
  const line = candidate.lineNumber ?? candidate.line ?? candidate.loc?.line;
  return typeof line === "number" ? line : undefined;
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const parseWithParser = (absolute: string, code: string): ParserOutput =>
  absolute.endsWith(".svelte")
    ? (svelteParser.parseForESLint(code, {
        parser: tsParser,
        filePath: absolute,
        ecmaVersion: "latest",
        sourceType: "module",
      }) as unknown as ParserOutput)
    : (tsParser.parseForESLint(code, {
        filePath: absolute,
        loc: true,
        range: true,
        sourceType: "module",
        ecmaVersion: "latest",
        ecmaFeatures: { jsx: !absolute.endsWith(".ts") },
      }) as unknown as ParserOutput);

export const parseSource = (
  root: string,
  absolute: string,
  code: string,
): Result<ParsedFile, Diagnostic> => {
  const relative = toPosix(path.relative(root, absolute));
  try {
    const output = parseWithParser(absolute, code);
    const program = output.ast as AstNode;
    const body = (program.body as AstNode[] | undefined) ?? [];
    return ok({
      path: relative,
      absolute,
      roots: absolute.endsWith(".svelte")
        ? body.filter((node) => node.type === "SvelteScriptElement")
        : [program],
      keys: output.visitorKeys as VisitorKeys,
      scope: output.scopeManager as ScopeManagerLike,
    });
  } catch (error) {
    return err({
      file: relative,
      line: errorLine(error),
      kind: "parse-error",
      message: errorMessage(error),
    });
  }
};

const literalString = (node: AstNode | undefined): string | undefined => {
  if (node?.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node?.type === "TemplateLiteral" && (node.expressions as unknown[]).length === 0) {
    const quasi = (node.quasis as AstNode[])[0];
    const cooked = (quasi?.value as { cooked?: unknown } | undefined)?.cooked;
    return typeof cooked === "string" ? cooked : undefined;
  }
  return undefined;
};

const specifiersAreTypeOnly = (node: AstNode, kindKey: "importKind" | "exportKind") => {
  const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
  return specifiers.length > 0 && specifiers.every((specifier) => specifier[kindKey] === "type");
};

const importSpecifier = (node: AstNode): string | undefined => {
  switch (node.type) {
    case "ImportDeclaration":
      return node.importKind === "type" || specifiersAreTypeOnly(node, "importKind")
        ? undefined
        : literalString(field(node, "source"));
    case "ExportNamedDeclaration":
      return node.exportKind === "type" || specifiersAreTypeOnly(node, "exportKind")
        ? undefined
        : literalString(field(node, "source"));
    case "ExportAllDeclaration":
      return node.exportKind === "type" ? undefined : literalString(field(node, "source"));
    case "ImportExpression":
      return literalString(field(node, "source"));
    case "CallExpression": {
      const callee = field(node, "callee");
      const args = (node.arguments as AstNode[] | undefined) ?? [];
      return callee?.type === "Identifier" && callee.name === "require" && args.length === 1
        ? literalString(args[0])
        : undefined;
    }
    case "TSImportEqualsDeclaration": {
      const reference = field(node, "moduleReference");
      return node.importKind !== "type" && reference?.type === "TSExternalModuleReference"
        ? literalString(field(reference, "expression"))
        : undefined;
    }
    default:
      return undefined;
  }
};

export const extractImports = (file: ParsedFile, nodes: readonly AstNode[]): ImportReference[] =>
  nodes.flatMap((node) => {
    const specifier = importSpecifier(node);
    return specifier === undefined ? [] : [{ specifier, location: locationOf(node, file.path) }];
  });

const keyName = (member: AstNode): string => {
  const key = field(member, "key");
  if (member.computed === true) {
    const literal = key?.type === "Literal" ? String(key.value) : undefined;
    return literal === undefined ? "[computed]" : `[${JSON.stringify(literal)}]`;
  }
  if (key?.type === "Identifier") return stringField(key, "name") ?? "<key>";
  if (key?.type === "PrivateIdentifier") return `#${stringField(key, "name")}`;
  if (key?.type === "Literal") return String(key.value);
  return "<key>";
};

const memberPath = (node: AstNode | undefined): string | undefined => {
  if (node?.type === "Identifier") return stringField(node, "name");
  if (node?.type === "ThisExpression") return "this";
  if (node?.type === "MemberExpression" && node.computed !== true) {
    const object = memberPath(field(node, "object"));
    const propertyNode = field(node, "property");
    const property = propertyNode && stringField(propertyNode, "name");
    return object && property ? `${object}.${property}` : undefined;
  }
  return undefined;
};

const bindingName = (holder: AstNode, parents: ReadonlyMap<AstNode, AstNode>) => {
  const parent = parents.get(holder);
  if (parent?.type === "VariableDeclarator" && field(parent, "init") === holder) {
    return memberPath(field(parent, "id"));
  }
  if (parent?.type === "AssignmentExpression" && field(parent, "right") === holder) {
    return memberPath(field(parent, "left"));
  }
  return undefined;
};

const className = (cls: AstNode | undefined, parents: ReadonlyMap<AstNode, AstNode>) =>
  (cls && memberPath(field(cls, "id"))) ??
  (cls && bindingName(outerOfWrappers(cls, parents), parents)) ??
  "<anonymous class>";

const accessorSuffix = (member: AstNode) =>
  member.kind === "get" ? " [get]" : member.kind === "set" ? " [set]" : "";

export const functionName = (fn: AstNode, parents: ReadonlyMap<AstNode, AstNode>): string => {
  const ownName = memberPath(field(fn, "id"));
  const anonymous = `<anonymous>@${fn.loc?.start.line ?? 0}`;
  if (fn.type === "FunctionDeclaration") return ownName ?? "default";
  const holder = outerOfWrappers(fn, parents);
  const parent = parents.get(holder);
  if (!parent) return ownName ?? anonymous;
  switch (parent.type) {
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty": {
      const cls = parents.get(parents.get(parent) as AstNode);
      return `${className(cls, parents)}.${keyName(parent)}${accessorSuffix(parent)}`;
    }
    case "Property": {
      if (field(parent, "value") !== holder) return ownName ?? anonymous;
      const object = parents.get(parent);
      const owner = object && bindingName(outerOfWrappers(object, parents), parents);
      const key = `${keyName(parent)}${accessorSuffix(parent)}`;
      return owner ? `${owner}.${key}` : key;
    }
    case "VariableDeclarator":
    case "AssignmentExpression":
      return bindingName(holder, parents) ?? ownName ?? anonymous;
    case "AssignmentPattern":
      return field(parent, "right") === holder
        ? (memberPath(field(parent, "left")) ?? ownName ?? anonymous)
        : (ownName ?? anonymous);
    case "ExportDefaultDeclaration":
      return ownName ?? "default";
    default:
      return ownName ?? anonymous;
  }
};

export const analyzeParsedFile = (file: ParsedFile): FileAnalysis => {
  const parents = parentMap(file.roots, file.keys);
  const nodes = file.roots.flatMap((root) => [root, ...descendants(root, file.keys)]);
  const functionNodes = nodes.filter(isFunction);
  const moduleKey = moduleId(file.path);
  const functions = functionNodes.map((fn): FunctionNode => {
    const location = locationOf(fn, file.path);
    return {
      id: functionId(location),
      moduleId: moduleKey,
      name: functionName(fn, parents),
      location,
      complexity: cyclomaticComplexity(fn, file.keys),
    };
  });
  const functionIds = new Map(functionNodes.map((fn, index) => [fn, functions[index]?.id ?? ""]));
  return {
    path: file.path,
    imports: extractImports(file, nodes),
    functions,
    calls: resolveLocalCalls(functionNodes, {
      file: file.path,
      keys: file.keys,
      parents,
      scope: file.scope,
      functionIds,
    }),
  };
};

const analyzeSource = (
  root: string,
  absolute: string,
  code: string,
): Result<FileAnalysis, Diagnostic> => {
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

const groupDependencyEdges = (
  sites: readonly { from: string; to: string; location: Location }[],
): DependencyEdge[] => [
  ...sites
    .reduce((map, site) => {
      const key = `${site.from}\u0000${site.to}`;
      return map.set(key, {
        kind: "imports" as const,
        from: site.from,
        to: site.to,
        occurrences: [...(map.get(key)?.occurrences ?? []), site.location],
      });
    }, new Map<string, DependencyEdge>())
    .values(),
];

const validateRoot = async (input: string): Promise<Result<string>> => {
  const resolved = await realpath(path.resolve(input)).catch(() => undefined);
  if (resolved === undefined) return err(`Path does not exist: ${input}`);
  const info = await stat(resolved);
  return info.isDirectory() ? ok(resolved) : err(`Path is not a directory: ${input}`);
};

export const analyzeProject = async (input: string): Promise<Result<GraphSnapshot>> => {
  const started = performance.now();
  const rootResult = await validateRoot(input);
  if (!rootResult.ok) return rootResult;
  const root = rootResult.value;
  const files = await discoverSourceFiles(root);
  const relative = (absolute: string) => toPosix(path.relative(root, absolute));

  const results = await Promise.all(
    files.map(async (absolute): Promise<Result<FileAnalysis, Diagnostic>> => {
      const code = await readFile(absolute, "utf8").catch((error: unknown) => error);
      return typeof code === "string"
        ? analyzeSource(root, absolute, code)
        : err({ file: relative(absolute), kind: "parse-error", message: errorMessage(code) });
    }),
  );
  const analyses = results.flatMap((result) => (result.ok ? [result.value] : []));
  const parseDiagnostics = results.flatMap((result) => (result.ok ? [] : [result.error]));

  const resolve = createResolver(root, new Set(files));
  const resolutions = analyses.flatMap((analysis) =>
    analysis.imports.map((reference) => ({
      reference,
      importer: analysis.path,
      resolution: resolve(reference.specifier, path.join(root, analysis.path)),
    })),
  );
  const dependencyEdges = groupDependencyEdges(
    resolutions.flatMap(({ reference, importer, resolution }) =>
      resolution.kind === "local"
        ? [
            {
              from: moduleId(importer),
              to: moduleId(relative(resolution.file)),
              location: reference.location,
            },
          ]
        : [],
    ),
  );
  const importDiagnostics = resolutions.flatMap(({ reference, importer, resolution }) =>
    resolution.kind === "unresolved"
      ? [
          {
            file: importer,
            line: reference.location.line,
            kind: "unresolved-import" as const,
            message: resolution.reason,
          },
        ]
      : [],
  );

  const externalsByModule = resolutions.reduce((map, { importer, resolution }) => {
    if (resolution.kind !== "external") return map;
    const id = moduleId(importer);
    return map.set(id, new Set([...(map.get(id) ?? []), resolution.name]));
  }, new Map<string, Set<string>>());

  const functions = analyses.flatMap((analysis) => analysis.functions);
  const functionsByModule = analyses.reduce(
    (map, analysis) => map.set(moduleId(analysis.path), analysis.functions),
    new Map<string, FunctionNode[]>(),
  );
  const modulePaths = files.map(relative);
  const moduleIds = modulePaths.map(moduleId);
  const metrics = moduleMetrics(moduleIds, dependencyEdges, functionsByModule);
  const apps = findSvelteKitApps(root, modulePaths);
  const structure = buildStructure(modulePaths, dependencyEdges, apps);
  const areaSides = new Set(["client", "shared", "server", "code"]);
  const areas = detectAreas(
    moduleIds.filter((id) => areaSides.has(structure.placements.get(id)?.side ?? "")),
    dependencyEdges,
  );
  const areaOf = new Map(
    areas.flatMap((area) => area.moduleIds.map((id) => [`${area.parent === null ? "top" : "sub"}:${id}`, area.id] as const)),
  );

  return ok({
    root,
    name: path.basename(root),
    scannedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    framework: apps.length > 0 ? "sveltekit" : null,
    lanes: structure.lanes,
    groups: structure.groups,
    groupEdges: structure.groupEdges,
    areas,
    routes: structure.routes,
    modules: modulePaths.map((modulePath) => {
      const id = moduleId(modulePath);
      return {
        id,
        path: modulePath,
        functionIds: (functionsByModule.get(id) ?? []).map((fn) => fn.id),
        metrics: metrics.get(id) as NonNullable<ReturnType<typeof metrics.get>>,
        placement: structure.placements.get(id) as NonNullable<ReturnType<typeof structure.placements.get>>,
        groupId: structure.groupOf.get(id) ?? "",
        areaId: areaOf.get(`top:${id}`) ?? null,
        subAreaId: areaOf.get(`sub:${id}`) ?? null,
        depth: structure.depth.get(id) ?? 0,
        position: structure.positions.get(id) ?? { x: 0, y: 0 },
        externals: [...(externalsByModule.get(id) ?? [])].sort(),
      };
    }),
    functions,
    dependencyEdges,
    callEdges: analyses.flatMap((analysis) => analysis.calls),
    diagnostics: [...parseDiagnostics, ...importDiagnostics, ...structure.warnings],
  });
};

export const functionLogic = async (snapshot: GraphSnapshot, id: string): Promise<Result<FunctionLogic>> => {
  const fn = snapshot.functions.find((candidate) => candidate.id === id);
  if (!fn) return err(`Unknown function: ${id}`);
  const absolute = path.join(snapshot.root, fn.location.file);
  const code = await readFile(absolute, "utf8").catch(() => undefined);
  if (code === undefined) return err(`Cannot read ${fn.location.file}`);
  const parsed = parseSource(snapshot.root, absolute, code);
  if (!parsed.ok) return err(parsed.error.message);
  const { roots, keys } = parsed.value;
  const node = roots
    .flatMap((root) => descendants(root, keys))
    .find(
      (candidate) =>
        isFunction(candidate) &&
        candidate.loc?.start.line === fn.location.line &&
        candidate.loc?.start.column === fn.location.column,
    );
  if (!node) return err("This function moved since the last scan. Rescan and try again.");
  return ok(
    buildLogic({
      fn: node,
      name: fn.name,
      file: fn.location.file,
      code,
      keys,
      complexity: cyclomaticComplexity(node, keys),
    }),
  );
};
