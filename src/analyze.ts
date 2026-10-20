import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as tsParser from "@typescript-eslint/parser";
import { type ScopeManager, analyze as analyzeScope } from "@typescript-eslint/scope-manager";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/types";
import { visitorKeys } from "@typescript-eslint/visitor-keys";
import ignore, { type Ignore } from "ignore";
import * as svelteParser from "svelte-eslint-parser";
import {
  type FunctionLike,
  type VisitorKeys,
  allNodes,
  indexTree,
  isFunction,
  locationOf,
  outerOfWrappers,
} from "./ast";
import { resolveLocalCalls } from "./calls";
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
  type Side,
  err,
  errorMessage,
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
  /** Top-level statements: the whole program, or the contents of every Svelte script element. */
  roots: TSESTree.ProgramStatement[];
  keys: VisitorKeys;
  scope: ScopeManager;
};

type Parsed = Pick<ParsedFile, "roots" | "keys" | "scope">;

type ImportReference = { specifier: string; location: Location };

type FileAnalysis = {
  path: string;
  imports: ImportReference[];
  functions: FunctionNode[];
  calls: CallEdge[];
};

const toPosix = (value: string) => value.split(path.sep).join("/");

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

const read = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;

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

  return { roots: ast.body, keys: visitorKeys, scope: analyzeScope(ast, { sourceType: "module" }) };
};

const parseSvelte = (absolute: string, code: string): Parsed => {
  const output = svelteParser.parseForESLint(code, {
    parser: tsParser,
    filePath: absolute,
    ecmaVersion: "latest",
    sourceType: "module",
  });
  const scripts = output.ast.body.flatMap((node) => (node.type === "SvelteScriptElement" ? node.body : []));

  // svelte-eslint-parser declares plain ESTree and ESLint scope types, but with `parser: tsParser`
  // the script contents and their scope come from typescript-eslint.
  return {
    roots: scripts as unknown as TSESTree.ProgramStatement[],
    keys: output.visitorKeys,
    scope: output.scopeManager as unknown as ScopeManager,
  };
};

export const parseSource = (root: string, absolute: string, code: string): Result<ParsedFile, Diagnostic> => {
  const relative = toPosix(path.relative(root, absolute));

  try {
    const parsed = absolute.endsWith(".svelte") ? parseSvelte(absolute, code) : parseScript(absolute, code);
    return ok({ path: relative, absolute, ...parsed });
  } catch (error) {
    return err({
      file: relative,
      line: errorLine(error),
      kind: "parse-error",
      message: errorMessage(error),
    });
  }
};

const literalString = (node: TSESTree.Node | null | undefined): string | undefined => {
  if (node?.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;

  return undefined;
};

const importSpecifier = (node: TSESTree.Node): string | undefined => {
  switch (node.type) {
    case "ImportDeclaration": {
      const typeOnly =
        node.specifiers.length > 0 &&
        node.specifiers.every((specifier) => specifier.type === "ImportSpecifier" && specifier.importKind === "type");
      return node.importKind === "type" || typeOnly ? undefined : literalString(node.source);
    }
    case "ExportNamedDeclaration": {
      const typeOnly =
        node.specifiers.length > 0 && node.specifiers.every((specifier) => specifier.exportKind === "type");
      return node.exportKind === "type" || typeOnly ? undefined : literalString(node.source);
    }
    case "ExportAllDeclaration":
      return node.exportKind === "type" ? undefined : literalString(node.source);
    case "ImportExpression":
      return literalString(node.source);
    case "CallExpression":
      return node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments.length === 1
        ? literalString(node.arguments[0])
        : undefined;
    case "TSImportEqualsDeclaration":
      return node.importKind !== "type" && node.moduleReference.type === "TSExternalModuleReference"
        ? literalString(node.moduleReference.expression)
        : undefined;
    default:
      return undefined;
  }
};

export const extractImports = (file: ParsedFile, nodes: readonly TSESTree.Node[]): ImportReference[] =>
  nodes.flatMap((node) => {
    const specifier = importSpecifier(node);
    return specifier === undefined ? [] : [{ specifier, location: locationOf(node, file.path) }];
  });

type Member = TSESTree.MethodDefinition | TSESTree.PropertyDefinition | TSESTree.AccessorProperty | TSESTree.Property;

const keyName = (member: Member): string => {
  const key = member.key;

  if (member.computed) return key.type === "Literal" ? `[${JSON.stringify(String(key.value))}]` : "[computed]";
  if (key.type === "Identifier") return key.name;
  if (key.type === "PrivateIdentifier") return `#${key.name}`;
  if (key.type === "Literal") return String(key.value);

  return "<key>";
};

const memberPath = (node: TSESTree.Node | null | undefined): string | undefined => {
  if (node?.type === "Identifier") return node.name;
  if (node?.type === "ThisExpression") return "this";

  if (node?.type === "MemberExpression" && !node.computed) {
    const object = memberPath(node.object);
    return object && `${object}.${node.property.name}`;
  }

  return undefined;
};

type Parents = ReadonlyMap<TSESTree.Node, TSESTree.Node>;

const bindingName = (holder: TSESTree.Node, parents: Parents) => {
  const parent = parents.get(holder);

  if (parent?.type === "VariableDeclarator" && parent.init === holder) return memberPath(parent.id);
  if (parent?.type === "AssignmentExpression" && parent.right === holder) return memberPath(parent.left);

  return undefined;
};

const className = (member: TSESTree.Node, parents: Parents) => {
  const body = parents.get(member);
  const cls = body && parents.get(body);
  const ownName = cls?.type === "ClassDeclaration" || cls?.type === "ClassExpression" ? memberPath(cls.id) : undefined;

  return ownName ?? (cls && bindingName(outerOfWrappers(cls, parents), parents)) ?? "<anonymous class>";
};

const accessorSuffix = (member: Member) =>
  "kind" in member && member.kind === "get" ? " [get]" : "kind" in member && member.kind === "set" ? " [set]" : "";

export const functionName = (fn: FunctionLike, parents: Parents): string => {
  const ownName = memberPath(fn.id);
  const anonymous = `<anonymous>@${fn.loc.start.line}`;

  if (fn.type === "FunctionDeclaration") return ownName ?? "default";

  const holder = outerOfWrappers(fn, parents);
  const parent = parents.get(holder);

  if (!parent) return ownName ?? anonymous;

  switch (parent.type) {
    case "MethodDefinition":
    case "PropertyDefinition":
    case "AccessorProperty":
      return `${className(parent, parents)}.${keyName(parent)}${accessorSuffix(parent)}`;
    case "Property": {
      if (parent.value !== holder) return ownName ?? anonymous;

      const object = parents.get(parent);
      const owner = object && bindingName(outerOfWrappers(object, parents), parents);
      const key = `${keyName(parent)}${accessorSuffix(parent)}`;

      return owner ? `${owner}.${key}` : key;
    }
    case "VariableDeclarator":
    case "AssignmentExpression":
      return bindingName(holder, parents) ?? ownName ?? anonymous;
    case "AssignmentPattern":
      return parent.right === holder ? (memberPath(parent.left) ?? ownName ?? anonymous) : (ownName ?? anonymous);
    case "ExportDefaultDeclaration":
      return ownName ?? "default";
    default:
      return ownName ?? anonymous;
  }
};

export const analyzeParsedFile = (file: ParsedFile): FileAnalysis => {
  const { nodes, parents } = indexTree(file.roots, file.keys);
  const functionNodes = nodes.filter(isFunction);
  const moduleKey = moduleId(file.path);
  const measured = functionNodes.map((fn) => {
    const location = locationOf(fn, file.path);
    const info: FunctionNode = {
      id: functionId(location),
      moduleId: moduleKey,
      name: functionName(fn, parents),
      location,
      complexity: cyclomaticComplexity(fn, file.keys),
    };

    return { fn, info };
  });

  return {
    path: file.path,
    imports: extractImports(file, nodes),
    functions: measured.map(({ info }) => info),
    calls: resolveLocalCalls(functionNodes, {
      file: file.path,
      keys: file.keys,
      parents,
      scope: file.scope,
      functionIds: new Map(measured.map(({ fn, info }) => [fn, info.id])),
    }),
  };
};

const analyzeSource = (root: string, absolute: string, code: string): Result<FileAnalysis, Diagnostic> => {
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

const groupDependencyEdges = (sites: readonly { from: string; to: string; location: Location }[]): DependencyEdge[] => [
  ...sites
    .reduce((map, site) => {
      const key = `${site.from}\u0000${site.to}`;
      return map.set(key, {
        kind: "imports",
        from: site.from,
        to: site.to,
        occurrences: [...(map.get(key)?.occurrences ?? []), site.location],
      });
    }, new Map<string, DependencyEdge>())
    .values(),
];

/** Reads a value every module is guaranteed to have; a miss is a bug in the analysis, not a property of the project. */
const required = <V>(map: ReadonlyMap<string, V>, id: string, what: string): V => {
  const value = map.get(id);

  if (value === undefined) throw new Error(`No ${what} computed for ${id}`);

  return value;
};

const validateRoot = async (input: string): Promise<Result<string>> => {
  const resolved = await realpath(path.resolve(input)).catch(() => undefined);

  if (resolved === undefined) return err(`Path does not exist: ${input}`);

  const info = await stat(resolved);

  return info.isDirectory() ? ok(resolved) : err(`Path is not a directory: ${input}`);
};

const areaSides = new Set<Side>(["client", "shared", "server", "code"]);

export type AnalysisCache = Map<string, { root: string; code: string; result: Result<FileAnalysis, Diagnostic> }>;

export const analyzeProject = async (
  input: string,
  cache: AnalysisCache = new Map(),
): Promise<Result<GraphSnapshot>> => {
  const started = performance.now();
  const rootResult = await validateRoot(input);

  if (!rootResult.ok) return rootResult;

  const root = rootResult.value;
  const files = await discoverSourceFiles(root);
  const relative = (absolute: string) => toPosix(path.relative(root, absolute));

  const analyzeCached = (absolute: string, code: string): Result<FileAnalysis, Diagnostic> => {
    const cached = cache.get(absolute);

    if (cached?.root === root && cached.code === code) return cached.result;

    const result = analyzeSource(root, absolute, code);
    cache.set(absolute, { root, code, result });

    return result;
  };

  const results = await Promise.all(
    files.map(async (absolute): Promise<Result<FileAnalysis, Diagnostic>> => {
      const code = await readFile(absolute, "utf8").catch((error: unknown) => error);
      return typeof code === "string"
        ? analyzeCached(absolute, code)
        : err({ file: relative(absolute), kind: "parse-error", message: errorMessage(code) });
    }),
  );
  const current = new Set(files);
  [...cache.keys()].filter((absolute) => !current.has(absolute)).forEach((absolute) => cache.delete(absolute));
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
  const importDiagnostics = resolutions.flatMap(({ reference, importer, resolution }): Diagnostic[] =>
    resolution.kind === "unresolved"
      ? [
          {
            file: importer,
            line: reference.location.line,
            kind: "unresolved-import",
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
  const areas = detectAreas(
    moduleIds.filter((id) => {
      const side = structure.placements.get(id)?.side;
      return side !== undefined && areaSides.has(side);
    }),
    dependencyEdges,
  );
  const areaOf = new Map(
    areas.flatMap((area) =>
      area.moduleIds.map((id) => [`${area.parent === null ? "top" : "sub"}:${id}`, area.id] as const),
    ),
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
        metrics: required(metrics, id, "metrics"),
        placement: required(structure.placements, id, "placement"),
        groupId: required(structure.groupOf, id, "group"),
        areaId: areaOf.get(`top:${id}`) ?? null,
        subAreaId: areaOf.get(`sub:${id}`) ?? null,
        depth: required(structure.depth, id, "depth"),
        position: required(structure.positions, id, "position"),
        externals: [...(externalsByModule.get(id) ?? [])].toSorted(),
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
  const node = allNodes(roots, keys)
    .filter(isFunction)
    .find(
      (candidate) => candidate.loc.start.line === fn.location.line && candidate.loc.start.column === fn.location.column,
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
