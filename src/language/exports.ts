import type { TSESTree } from "@typescript-eslint/types";
import type { ExportTable, Reexport } from "./barrels";
import { importedName, nameOf } from "./imports";
import type { ParsedFile } from "./parse";
import { isComponent } from "./svelte";

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
  const svelte = isComponent(file.path);

  return {
    barrel: !svelte && !parts.some((part) => part.own) && parts.some((part) => part.forwards > 0),
    names: [...new Set([...(svelte ? ["default"] : []), ...parts.flatMap((part) => part.names)])],
    reexports: parts.flatMap((part) => part.reexports),
    stars: parts.flatMap((part) => part.stars),
  };
};
