import type { Location } from "./model";

export type Position = { line: number; column: number };

export type AstNode = {
  type: string;
  loc?: { start: Position; end: Position };
  [key: string]: unknown;
};

export type VisitorKeys = Readonly<Record<string, readonly string[] | undefined>>;

const skippedKeys = new Set([
  "parent",
  "loc",
  "range",
  "tokens",
  "comments",
  "typeAnnotation",
  "returnType",
  "typeParameters",
  "typeArguments",
  "superTypeArguments",
  "decorators",
]);

const typeOnlyNodes = new Set([
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSDeclareFunction",
  "TSEmptyBodyFunctionExpression",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractAccessorProperty",
  "TSIndexSignature",
  "TSImportType",
]);

export const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as { type?: unknown }).type === "string";

const asNodes = (value: unknown): AstNode[] =>
  Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];

export const children = (node: AstNode, keys: VisitorKeys): AstNode[] =>
  (keys[node.type] ?? Object.keys(node))
    .filter((key) => !skippedKeys.has(key))
    .flatMap((key) => asNodes(node[key]))
    .filter((child) => !typeOnlyNodes.has(child.type));

export const descendants = (
  node: AstNode,
  keys: VisitorKeys,
  stopAt: (node: AstNode) => boolean = () => false,
): AstNode[] =>
  children(node, keys).flatMap((child) =>
    stopAt(child) ? [child] : [child, ...descendants(child, keys, stopAt)],
  );

export const parentMap = (roots: AstNode[], keys: VisitorKeys): Map<AstNode, AstNode> =>
  new Map(
    roots.flatMap((root) =>
      [root, ...descendants(root, keys)].flatMap((parent) =>
        children(parent, keys).map((child) => [child, parent] as const),
      ),
    ),
  );

export const functionTypes = new Set([
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
]);

export const isFunction = (node: AstNode) => functionTypes.has(node.type);

export const locationOf = (node: AstNode, file: string): Location => ({
  file,
  line: node.loc?.start.line ?? 0,
  column: node.loc?.start.column ?? 0,
});

export const field = (node: AstNode, key: string): AstNode | undefined => {
  const value = node[key];
  return isNode(value) ? value : undefined;
};

export const stringField = (node: AstNode, key: string): string | undefined => {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
};

const transparentWrappers = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

export const unwrapExpression = (node: AstNode | undefined): AstNode | undefined =>
  node && transparentWrappers.has(node.type)
    ? unwrapExpression(field(node, "expression"))
    : node;

export const outerOfWrappers = (node: AstNode, parents: ReadonlyMap<AstNode, AstNode>): AstNode => {
  const parent = parents.get(node);
  return parent && transparentWrappers.has(parent.type) ? outerOfWrappers(parent, parents) : node;
};
