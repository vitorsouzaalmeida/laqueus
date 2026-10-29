import type { TSESTree } from "@typescript-eslint/types";
import type { Location } from "../model";
import { locationOf, read } from "./ast";
import type { ParsedFile } from "./parse";

export type ImportReference = { specifier: string; location: Location; names: string[]; typeOnly: boolean };

export const literalString = (node: TSESTree.Node | null | undefined): string | undefined => {
  if (node?.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0)
    return node.quasis[0]?.value.cooked ?? undefined;

  return undefined;
};

type Reference = Omit<ImportReference, "location">;

export const nameOf = (node: TSESTree.Identifier | TSESTree.StringLiteral) =>
  node.type === "Identifier" ? node.name : node.value;

export const importedName = (specifier: TSESTree.ImportClause) => {
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
