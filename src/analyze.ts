import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import * as tsParser from "@typescript-eslint/parser";
import { type ScopeManager, type Variable, analyze as analyzeScope } from "@typescript-eslint/scope-manager";
import { parse } from "@typescript-eslint/typescript-estree";
import type { TSESTree } from "@typescript-eslint/types";
import { visitorKeys } from "@typescript-eslint/visitor-keys";
import ignore, { type Ignore } from "ignore";
import * as svelteParser from "svelte-eslint-parser";
import {
  type FunctionLike,
  type VisitorKeys,
  indexTree,
  isFunction,
  locationOf,
  outerOfWrappers,
  unwrapExpression,
} from "./ast";
import { type ExportTable, type Reexport, barrelResolver } from "./barrels";
import { resolveLocalCalls } from "./calls";
import { detectAreas } from "./areas";
import { buildLogic, buildMarkupLogic } from "./logic";
import {
  branchComplexity,
  cyclomaticComplexity,
  inclusiveComplexity,
  isOwnershipBoundary,
  measureTemplate,
  moduleMetrics,
  ownNodes,
} from "./metrics";
import {
  type Area,
  type CallEdge,
  type ClassNode,
  type DependencyEdge,
  type Diagnostic,
  type FunctionLogic,
  type FunctionNode,
  type GraphSnapshot,
  type Location,
  type Result,
  type Side,
  classId,
  err,
  errorMessage,
  functionId,
  moduleId,
  ok,
} from "./model";
import { createResolver } from "./resolve";
import { buildStructure, findSvelteKitApps, isTest } from "./structure";

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
  template: TSESTree.Node[];
  keys: VisitorKeys;
  scope: ScopeManager;
};

type Parsed = Pick<ParsedFile, "roots" | "template" | "keys" | "scope">;

type ImportReference = { specifier: string; location: Location; names: string[]; typeOnly: boolean };

type FileAnalysis = {
  path: string;
  imports: ImportReference[];
  exports: ExportTable;
  functions: FunctionNode[];
  classes: ClassNode[];
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

  return { roots: ast.body, template: [], keys: visitorKeys, scope: analyzeScope(ast, { sourceType: "module" }) };
};

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

const parseSvelte = (absolute: string, code: string): Parsed => {
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

type Reference = Omit<ImportReference, "location">;

const nameOf = (node: TSESTree.Identifier | TSESTree.StringLiteral) =>
  node.type === "Identifier" ? node.name : node.value;

const importedName = (specifier: TSESTree.ImportClause) => {
  if (specifier.type === "ImportDefaultSpecifier") return "default";
  if (specifier.type === "ImportNamespaceSpecifier") return "*";

  return nameOf(specifier.imported);
};

const split = (specifier: string, values: readonly string[], types: readonly string[], bare: boolean): Reference[] => [
  ...(values.length > 0 || bare
    ? [{ specifier, names: values.length > 0 ? [...values] : ["*"], typeOnly: false }]
    : []),
  ...(types.length > 0 ? [{ specifier, names: [...types], typeOnly: true }] : []),
];

const referencesOf = (node: TSESTree.Node): Reference[] => {
  switch (node.type) {
    case "ImportDeclaration": {
      const source = node.source.value;
      const types = node.specifiers.filter(
        (specifier) =>
          node.importKind === "type" || (specifier.type === "ImportSpecifier" && specifier.importKind === "type"),
      );
      const values = node.specifiers.filter((specifier) => !types.includes(specifier));

      return split(source, values.map(importedName), types.map(importedName), node.specifiers.length === 0);
    }
    case "ExportNamedDeclaration": {
      const source = literalString(node.source);

      if (source === undefined) return [];

      const types = node.specifiers.filter(
        (specifier) => node.exportKind === "type" || specifier.exportKind === "type",
      );
      const values = node.specifiers.filter((specifier) => !types.includes(specifier));
      const local = (specifier: TSESTree.ExportSpecifier) => nameOf(specifier.local);

      return split(source, values.map(local), types.map(local), node.specifiers.length === 0);
    }
    case "ExportAllDeclaration": {
      const source = literalString(node.source);
      return source === undefined ? [] : [{ specifier: source, names: ["*"], typeOnly: node.exportKind === "type" }];
    }
    case "ImportExpression": {
      const source = literalString(node.source);
      return source === undefined ? [] : [{ specifier: source, names: ["*"], typeOnly: false }];
    }
    case "CallExpression": {
      const source =
        node.callee.type === "Identifier" && node.callee.name === "require" && node.arguments.length === 1
          ? literalString(node.arguments[0])
          : undefined;
      return source === undefined ? [] : [{ specifier: source, names: ["*"], typeOnly: false }];
    }
    case "TSImportEqualsDeclaration": {
      const source =
        node.moduleReference.type === "TSExternalModuleReference"
          ? literalString(node.moduleReference.expression)
          : undefined;
      return source === undefined ? [] : [{ specifier: source, names: ["*"], typeOnly: node.importKind === "type" }];
    }
    default:
      return [];
  }
};

const skippedForTypes = new Set(["parent", "loc", "range", "tokens", "comments"]);

const inlineTypeImports = (roots: readonly TSESTree.Node[]): TSESTree.TSImportType[] => {
  const found: TSESTree.TSImportType[] = [];
  const stack: unknown[] = [...roots];

  for (let value = stack.pop(); value !== undefined; value = stack.pop()) {
    if (typeof value !== "object" || value === null) continue;

    if (Array.isArray(value)) {
      stack.push(...value);
      continue;
    }

    if (read(value, "type") === "TSImportType") found.push(value as TSESTree.TSImportType);

    Object.entries(value).forEach(([key, child]) => {
      if (!skippedForTypes.has(key)) stack.push(child);
    });
  }

  return found.toSorted((a, b) => a.range[0] - b.range[0]);
};

const leftmost = (name: TSESTree.EntityName): string => {
  if (name.type === "TSQualifiedName") return leftmost(name.left);
  if (name.type === "Identifier") return name.name;

  return "*";
};

const typeImportReference = (node: TSESTree.TSImportType, file: string): ImportReference[] => {
  const argument = node.argument;
  const source = argument.type === "TSLiteralType" ? literalString(argument.literal) : undefined;

  return source === undefined
    ? []
    : [
        {
          specifier: source,
          location: locationOf(node, file),
          names: [node.qualifier ? leftmost(node.qualifier) : "*"],
          typeOnly: true,
        },
      ];
};

export const extractImports = (file: ParsedFile, nodes: readonly TSESTree.Node[]): ImportReference[] => [
  ...nodes.flatMap((node) =>
    referencesOf(node).map((reference) => ({ ...reference, location: locationOf(node, file.path) })),
  ),
  ...inlineTypeImports(file.roots).flatMap((node) => typeImportReference(node, file.path)),
];

const typeOnlyStatements = new Set([
  "TSTypeAliasDeclaration",
  "TSInterfaceDeclaration",
  "TSDeclareFunction",
  "TSModuleDeclaration",
  "EmptyStatement",
]);

const patternNames = (node: TSESTree.Node | null): string[] => {
  switch (node?.type) {
    case "Identifier":
      return [node.name];
    case "ObjectPattern":
      return node.properties.flatMap((property) =>
        patternNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return node.elements.flatMap(patternNames);
    case "AssignmentPattern":
      return patternNames(node.left);
    case "RestElement":
      return patternNames(node.argument);
    default:
      return [];
  }
};

const declaredNames = (declaration: TSESTree.NamedExportDeclarations): string[] => {
  switch (declaration.type) {
    case "VariableDeclaration":
      return declaration.declarations.flatMap((declarator) => patternNames(declarator.id));
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSEnumDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSInterfaceDeclaration":
    case "TSDeclareFunction":
      return declaration.id ? [declaration.id.name] : [];
    case "TSModuleDeclaration":
      return declaration.id.type === "Identifier" ? [declaration.id.name] : [];
    default:
      return [];
  }
};

type Exports = { own: boolean; forwards: number; names: string[]; reexports: Reexport[]; stars: string[] };

export const extractExports = (file: ParsedFile): ExportTable => {
  const statements = file.roots;
  const imported = new Map(
    statements.flatMap((statement) =>
      statement.type === "ImportDeclaration"
        ? statement.specifiers.map(
            (specifier) =>
              [specifier.local.name, { specifier: statement.source.value, imported: importedName(specifier) }] as const,
          )
        : [],
    ),
  );

  const visit = (statement: TSESTree.ProgramStatement): Exports => {
    const none: Exports = { own: false, forwards: 0, names: [], reexports: [], stars: [] };

    switch (statement.type) {
      case "ImportDeclaration":
        return none;
      case "ExportAllDeclaration": {
        const specifier = statement.source.value;
        const forwards = statement.exportKind === "type" ? 0 : 1;

        return statement.exported
          ? {
              ...none,
              forwards,
              names: [nameOf(statement.exported)],
              reexports: [{ name: nameOf(statement.exported), specifier, imported: "*" }],
            }
          : { ...none, forwards, stars: [specifier] };
      }
      case "ExportNamedDeclaration": {
        if (statement.declaration)
          return typeOnlyStatements.has(statement.declaration.type)
            ? { ...none, names: declaredNames(statement.declaration) }
            : { ...none, own: true, names: declaredNames(statement.declaration) };

        const source = statement.source?.value;
        const bound = statement.specifiers.flatMap((specifier) => {
          const name = nameOf(specifier.exported);
          const local = nameOf(specifier.local);
          const binding = source === undefined ? imported.get(local) : { specifier: source, imported: local };
          const value = statement.exportKind !== "type" && specifier.exportKind !== "type";

          return binding ? [{ reexport: { name, ...binding }, value }] : [];
        });
        const values = statement.specifiers.filter(
          (specifier) => statement.exportKind !== "type" && specifier.exportKind !== "type",
        );

        return {
          own: bound.filter((entry) => entry.value).length < values.length,
          forwards: bound.filter((entry) => entry.value).length,
          names: statement.specifiers.map((specifier) => nameOf(specifier.exported)),
          reexports: bound.map((entry) => entry.reexport),
          stars: [],
        };
      }
      case "ExportDefaultDeclaration": {
        const binding =
          statement.declaration.type === "Identifier" ? imported.get(statement.declaration.name) : undefined;

        return binding
          ? { ...none, forwards: 1, names: ["default"], reexports: [{ name: "default", ...binding }] }
          : { ...none, own: true, names: ["default"] };
      }
      default:
        return typeOnlyStatements.has(statement.type) ? none : { ...none, own: true };
    }
  };

  const parts = statements.map(visit);
  const svelte = file.path.endsWith(".svelte");

  return {
    barrel: !svelte && !parts.some((part) => part.own) && parts.some((part) => part.forwards > 0),
    names: [...new Set([...(svelte ? ["default"] : []), ...parts.flatMap((part) => part.names)])],
    reexports: parts.flatMap((part) => part.reexports),
    stars: parts.flatMap((part) => part.stars),
  };
};

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

const calleeLabel = (callee: TSESTree.Node): string => {
  const inner = unwrapExpression(callee) ?? callee;
  const named = memberPath(inner);

  if (named) return named;

  return inner.type === "MemberExpression" && !inner.computed ? inner.property.name : "call";
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

const markupLabel = (holder: TSESTree.Node, parents: Parents): string | undefined => {
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

type Owner = FunctionLike | TSESTree.Node | "template";

const isSnippet = (node: unknown) => read(node, "type") === "SvelteSnippetBlock";

export const templateName = "<template>";

export const functionNamer = (parents: Parents, template: ReadonlySet<TSESTree.Node>) => {
  const names = new Map<TSESTree.Node, string>();

  const ownerOf = (node: TSESTree.Node): Owner | undefined => {
    const parent = parents.get(node);

    if (!parent) return template.has(node) ? "template" : undefined;

    return isFunction(parent) || isSnippet(parent) ? parent : ownerOf(parent);
  };

  const anonymous = (fn: FunctionLike, holder: TSESTree.Node): string => {
    const parent = parents.get(holder);
    const isArgument =
      (parent?.type === "CallExpression" || parent?.type === "NewExpression") &&
      parent.arguments.some((argument) => argument === holder);
    const markup = markupLabel(holder, parents);

    if (isArgument && parent)
      return `${parent.type === "NewExpression" ? "new " : ""}${calleeLabel(parent.callee)} callback`;
    if (markup !== undefined) return `${markup} callback`;

    return `<anonymous>@${fn.loc.start.line}`;
  };

  const ownLabel = (fn: FunctionLike): string => {
    const ownName = memberPath(fn.id);
    const holder = outerOfWrappers(fn, parents);
    const fallback = () => ownName ?? anonymous(fn, holder);

    if (fn.type === "FunctionDeclaration") return ownName ?? "default";

    const parent = parents.get(holder);

    if (!parent) return fallback();

    switch (parent.type) {
      case "MethodDefinition":
      case "PropertyDefinition":
      case "AccessorProperty":
        return `${className(parent, parents)}.${keyName(parent)}${accessorSuffix(parent)}`;
      case "Property": {
        if (parent.value !== holder) return fallback();

        const object = parents.get(parent);
        const owner = object && bindingName(outerOfWrappers(object, parents), parents);
        const key = `${keyName(parent)}${accessorSuffix(parent)}`;

        return owner ? `${owner}.${key}` : key;
      }
      case "VariableDeclarator":
      case "AssignmentExpression":
        return bindingName(holder, parents) ?? fallback();
      case "AssignmentPattern":
        return parent.right === holder ? (memberPath(parent.left) ?? fallback()) : fallback();
      case "ExportDefaultDeclaration":
        return ownName ?? "default";
      default:
        return fallback();
    }
  };

  const labelOf = (node: TSESTree.Node): string => {
    if (isFunction(node)) return ownLabel(node);

    const name = read(read(node, "id"), "name");

    return typeof name === "string" ? name : "snippet";
  };

  const prefix = (node: TSESTree.Node): string => {
    const owner = ownerOf(node);

    if (owner === undefined) return "";

    return `${owner === "template" ? templateName : nameFor(owner)} › `;
  };

  const nameFor = (node: TSESTree.Node): string => {
    const known = names.get(node);

    if (known !== undefined) return known;

    const name = `${prefix(node)}${labelOf(node)}`;
    names.set(node, name);

    return name;
  };

  const classLabel = (cls: TSESTree.ClassDeclaration | TSESTree.ClassExpression): string =>
    `${prefix(cls)}${memberPath(cls.id) ?? bindingName(outerOfWrappers(cls, parents), parents) ?? "<anonymous class>"}`;

  return { nameFor, classLabel };
};

const declaredVariable = (variable: Variable) =>
  variable.defs.some(
    (def) =>
      def.type === "Parameter" ||
      (def.type === "Variable" && def.parent.type === "VariableDeclaration" && def.parent.kind !== "const"),
  );

const outerWrites = (fn: FunctionLike, scope: ScopeManager): number => {
  const own = scope.acquire(fn, true);

  if (!own) return 0;

  const home = own.variableScope;
  const declared = scope.scopes
    .filter((candidate) => candidate.variableScope === home)
    .flatMap((candidate) => candidate.variables.filter(declaredVariable));

  return declared.filter((variable) =>
    variable.references.some(
      (reference) => reference.isWrite() && !reference.init && reference.from.variableScope !== home,
    ),
  ).length;
};

type Measured = {
  node: TSESTree.Node | null;
  owned: TSESTree.Node[];
  lines: { start: number; end: number };
  info: FunctionNode;
};

const isClass = (node: TSESTree.Node): node is TSESTree.ClassDeclaration | TSESTree.ClassExpression =>
  node.type === "ClassDeclaration" || node.type === "ClassExpression";

const measureFile = (file: ParsedFile) => {
  const { nodes, parents } = indexTree([...file.roots, ...file.template], file.keys);
  const namer = functionNamer(parents, new Set(file.template));
  const moduleKey = moduleId(file.path);
  const functions = nodes.filter(isFunction);
  const real = functions.map((fn): Measured => {
    const location = locationOf(fn, file.path);
    return {
      node: fn,
      owned: [],
      lines: { start: fn.loc.start.line, end: fn.loc.end.line },
      info: {
        id: functionId(location),
        moduleId: moduleKey,
        name: namer.nameFor(fn),
        location,
        complexity: cyclomaticComplexity(fn, file.keys),
        branches: branchComplexity(fn, file.keys),
        inclusive: inclusiveComplexity(fn, file.keys),
        outerWrites: outerWrites(fn, file.scope),
      },
    };
  });
  const snippets = nodes.filter(isSnippet).map((snippet): Measured => {
    const location = locationOf(snippet, file.path);
    return {
      node: snippet,
      owned: ownNodes(snippet, file.keys),
      lines: { start: snippet.loc.start.line, end: snippet.loc.end.line },
      info: {
        id: functionId(location),
        moduleId: moduleKey,
        name: namer.nameFor(snippet),
        location,
        complexity: cyclomaticComplexity(snippet, file.keys),
        branches: branchComplexity(snippet, file.keys),
        inclusive: inclusiveComplexity(snippet, file.keys),
        outerWrites: 0,
      },
    };
  });
  const [first] = file.template;
  const last = file.template.at(-1);
  const markup = first
    ? ((): Measured[] => {
        const location = locationOf(first, file.path);
        return [
          {
            node: null,
            owned: file.template.flatMap((root) =>
              isOwnershipBoundary(root) ? [] : [root, ...ownNodes(root, file.keys)],
            ),
            lines: { start: first.loc.start.line, end: last?.loc.end.line ?? first.loc.end.line },
            info: {
              id: `${functionId(location)}:template`,
              moduleId: moduleKey,
              name: templateName,
              location,
              ...measureTemplate(file.template, file.keys),
              outerWrites: 0,
            },
          },
        ];
      })()
    : [];
  const classes = nodes.filter(isClass).map((cls): ClassNode => {
    const location = locationOf(cls, file.path);
    return {
      id: classId(location),
      moduleId: moduleKey,
      name: namer.classLabel(cls),
      location,
      inclusive: inclusiveComplexity(cls.body, file.keys),
    };
  });

  return {
    nodes,
    parents,
    functions,
    measured: [...real, ...markup, ...snippets].toSorted(
      (a, b) => a.info.location.line - b.info.location.line || a.info.location.column - b.info.location.column,
    ),
    classes,
  };
};

export const analyzeParsedFile = (file: ParsedFile): FileAnalysis => {
  const { nodes, parents, functions, measured, classes } = measureFile(file);
  const ids = new Map(
    measured.flatMap(({ node, info }) => (node !== null && isFunction(node) ? [[node, info.id] as const] : [])),
  );

  return {
    path: file.path,
    imports: extractImports(file, nodes),
    exports: extractExports(file),
    functions: measured.map(({ info }) => info),
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

type ImportSite = {
  from: string;
  to: string;
  location: Location;
  names: readonly string[];
  via: readonly string[];
  typeOnly: boolean;
};

const merged = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].toSorted();

const groupDependencyEdges = (sites: readonly ImportSite[]): DependencyEdge[] => [
  ...sites
    .reduce((map, site) => {
      const key = `${site.from}\u0000${site.to}`;
      const known = map.get(key);
      return map.set(key, {
        kind: "imports",
        from: site.from,
        to: site.to,
        occurrences: [...(known?.occurrences ?? []), site.location],
        names: merged(known?.names ?? [], site.names),
        via: merged(known?.via ?? [], site.via),
        typeOnly: (known?.typeOnly ?? true) && site.typeOnly,
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

const areaSides: readonly Side[] = ["client", "shared", "server", "code"];

export type AnalysisCache = Map<string, { root: string; code: string; result: Result<FileAnalysis, Diagnostic> }>;

export const analyzeProject = async (
  input: string,
  cache: AnalysisCache = new Map(),
): Promise<Result<GraphSnapshot>> => {
  const started = performance.now();
  const rootResult = await validateRoot(input);

  if (!rootResult.ok) return rootResult;

  const root = rootResult.value;
  const discovered = await discoverSourceFiles(root);
  const relative = (absolute: string) => toPosix(path.relative(root, absolute));
  const tests = new Set(discovered.filter((absolute) => isTest(relative(absolute))));
  const files = discovered.filter((absolute) => !tests.has(absolute));

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

  const resolve = createResolver(root, new Set(discovered));
  const resolutions = analyses.flatMap((analysis) =>
    analysis.imports.flatMap((reference) => {
      const resolution = resolve(reference.specifier, path.join(root, analysis.path));

      return resolution.kind === "local" && tests.has(resolution.file)
        ? []
        : [{ reference, importer: analysis.path, resolution }];
    }),
  );
  const targets = new Map(
    resolutions.flatMap(({ reference, importer, resolution }) =>
      resolution.kind === "local"
        ? [[`${importer}\u0000${reference.specifier}`, relative(resolution.file)] as const]
        : [],
    ),
  );
  const exportTables = new Map(analyses.map((analysis) => [analysis.path, analysis.exports]));
  const define = barrelResolver(exportTables, (file, specifier) => targets.get(`${file}\u0000${specifier}`));
  const localImports = resolutions.flatMap(({ reference, importer, resolution }) =>
    resolution.kind === "local" ? [{ reference, importer, file: relative(resolution.file) }] : [],
  );
  const importEdges = groupDependencyEdges(
    localImports.map(({ reference, importer, file }) => ({
      from: moduleId(importer),
      to: moduleId(file),
      location: reference.location,
      names: reference.names,
      via: [],
      typeOnly: reference.typeOnly,
    })),
  );
  const dependencyEdges = groupDependencyEdges(
    localImports.flatMap(({ reference, importer, file }) =>
      [
        ...reference.names
          .map((name) => define(file, name))
          .reduce(
            (map, definition) => map.set(definition.file, [...(map.get(definition.file) ?? []), definition]),
            new Map<string, ReturnType<typeof define>[]>(),
          ),
      ].flatMap(([target, definitions]): ImportSite[] => {
        const via = [...new Set(definitions.flatMap((definition) => definition.via))].map(moduleId);

        return target === importer && via.length > 0
          ? []
          : [
              {
                from: moduleId(importer),
                to: moduleId(target),
                location: reference.location,
                names: definitions.map((definition) => definition.name),
                via,
                typeOnly: reference.typeOnly,
              },
            ];
      }),
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
  const selfImports = dependencyEdges.flatMap((edge): Diagnostic[] => {
    const file = edge.from.slice("module:".length);

    return edge.from === edge.to && !file.endsWith(".svelte")
      ? [{ file, line: edge.occurrences[0]?.line, kind: "self-import", message: "This file imports itself." }]
      : [];
  });

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
  const apps = findSvelteKitApps(root, modulePaths);
  const structure = buildStructure(modulePaths, importEdges, apps);
  const metrics = moduleMetrics(moduleIds, dependencyEdges, functionsByModule);
  const areas: Area[] = areaSides.flatMap((side) =>
    detectAreas(
      moduleIds.filter((id) => structure.placements.get(id)?.side === side),
      dependencyEdges,
      side,
    ),
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
        barrel: exportTables.get(modulePath)?.barrel ?? false,
      };
    }),
    functions,
    classes: analyses.flatMap((analysis) => analysis.classes),
    dependencyEdges,
    callEdges: analyses.flatMap((analysis) => analysis.calls),
    diagnostics: [...parseDiagnostics, ...importDiagnostics, ...selfImports, ...structure.warnings],
  });
};

export const fileLogic = async (snapshot: GraphSnapshot, file: string): Promise<Result<Map<string, FunctionLogic>>> => {
  const absolute = path.join(snapshot.root, file);
  const code = await readFile(absolute, "utf8").catch(() => undefined);

  if (code === undefined) return err(`Cannot read ${file}`);

  const parsed = parseSource(snapshot.root, absolute, code);

  if (!parsed.ok) return err(parsed.error.message);

  const { keys } = parsed.value;
  const names = new Map(snapshot.functions.filter((fn) => fn.location.file === file).map((fn) => [fn.id, fn.name]));

  return ok(
    new Map(
      measureFile(parsed.value).measured.flatMap(({ node, owned, lines, info }) => {
        const name = names.get(info.id);

        if (name === undefined) return [];

        return [
          [
            info.id,
            node !== null && isFunction(node)
              ? buildLogic({ fn: node, name, file, code, keys, complexity: info.complexity })
              : buildMarkupLogic({ id: info.id, name, file, code, complexity: info.complexity, owned, lines }),
          ] as const,
        ];
      }),
    ),
  );
};

export const functionLogic = async (snapshot: GraphSnapshot, id: string): Promise<Result<FunctionLogic>> => {
  const fn = snapshot.functions.find((candidate) => candidate.id === id);

  if (!fn) return err(`Unknown function: ${id}`);

  const logic = await fileLogic(snapshot, fn.location.file);

  if (!logic.ok) return logic;

  const found = logic.value.get(id);

  return found ? ok(found) : err("This function moved since the last scan. Rescan and try again.");
};
