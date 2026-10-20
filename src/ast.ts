import type { TSESTree } from "@typescript-eslint/types";
import type { Location } from "./model";

export type VisitorKeys = Readonly<Record<string, readonly string[] | undefined>>;

/** The functions the analysis measures; TypeScript-only signatures have no runtime body. */
export type FunctionLike =
  | TSESTree.ArrowFunctionExpression
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression;

type Wrapper =
  | TSESTree.TSAsExpression
  | TSESTree.TSSatisfiesExpression
  | TSESTree.TSNonNullExpression
  | TSESTree.TSTypeAssertion
  | TSESTree.TSInstantiationExpression;

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

const functionTypes = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const transparentWrappers = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
]);

const isNode = (value: unknown): value is TSESTree.Node =>
  typeof value === "object" && value !== null && "type" in value && typeof value.type === "string";

const asNodes = (value: unknown): TSESTree.Node[] =>
  Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [];

/** The one generic read: the walker follows the parser's visitor keys, so it cannot name the fields it visits. */
export const children = (node: TSESTree.Node, keys: VisitorKeys): TSESTree.Node[] =>
  (keys[node.type] ?? Object.keys(node))
    .filter((key) => !skippedKeys.has(key))
    .flatMap((key) => asNodes(Reflect.get(node, key)))
    .filter((child) => !typeOnlyNodes.has(child.type));

export const descendants = (
  node: TSESTree.Node,
  keys: VisitorKeys,
  stopAt: (node: TSESTree.Node) => boolean = () => false,
): TSESTree.Node[] =>
  children(node, keys).flatMap((child) => (stopAt(child) ? [child] : [child, ...descendants(child, keys, stopAt)]));

/** Every node under the roots, roots included. */
export const allNodes = (roots: readonly TSESTree.Node[], keys: VisitorKeys): TSESTree.Node[] =>
  roots.flatMap((root) => [root, ...descendants(root, keys)]);

export const parentMap = (roots: readonly TSESTree.Node[], keys: VisitorKeys): Map<TSESTree.Node, TSESTree.Node> =>
  new Map(allNodes(roots, keys).flatMap((parent) => children(parent, keys).map((child) => [child, parent] as const)));

export const isFunction = (node: TSESTree.Node): node is FunctionLike => functionTypes.has(node.type);

const isWrapper = (node: TSESTree.Node): node is Wrapper => transparentWrappers.has(node.type);

export const locationOf = (node: TSESTree.Node, file: string): Location => ({
  file,
  line: node.loc.start.line,
  column: node.loc.start.column,
});

export const unwrapExpression = (node: TSESTree.Node | null | undefined): TSESTree.Node | undefined =>
  !node ? undefined : isWrapper(node) ? unwrapExpression(node.expression) : node;

export const outerOfWrappers = (
  node: TSESTree.Node,
  parents: ReadonlyMap<TSESTree.Node, TSESTree.Node>,
): TSESTree.Node => {
  const parent = parents.get(node);
  return parent && isWrapper(parent) ? outerOfWrappers(parent, parents) : node;
};
