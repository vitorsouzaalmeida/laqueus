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

const isWalkable = (value: unknown): value is TSESTree.Node => isNode(value) && !typeOnlyNodes.has(value.type);

/** The one generic read: the walker follows the parser's visitor keys, so it cannot name the fields it visits. */
export const children = (node: TSESTree.Node, keys: VisitorKeys): TSESTree.Node[] => {
  const found: TSESTree.Node[] = [];

  for (const key of keys[node.type] ?? Object.keys(node)) {
    if (skippedKeys.has(key)) continue;

    const value: unknown = Reflect.get(node, key);

    if (Array.isArray(value)) {
      for (const item of value) if (isWalkable(item)) found.push(item);
    } else if (isWalkable(value)) {
      found.push(value);
    }
  }

  return found;
};

type Visit = (node: TSESTree.Node, parent: TSESTree.Node | undefined) => void;

const never = () => false;

const walk = (
  start: readonly TSESTree.Node[],
  parent: TSESTree.Node | undefined,
  keys: VisitorKeys,
  stopAt: (node: TSESTree.Node) => boolean,
  visit: Visit,
) => {
  const nodes = start.toReversed();
  const parents = nodes.map(() => parent);

  for (let node = nodes.pop(); node !== undefined; node = nodes.pop()) {
    visit(node, parents.pop());

    if (stopAt(node)) continue;

    for (const child of children(node, keys).toReversed()) {
      nodes.push(child);
      parents.push(node);
    }
  }
};

export const descendants = (
  node: TSESTree.Node,
  keys: VisitorKeys,
  stopAt: (node: TSESTree.Node) => boolean = never,
): TSESTree.Node[] => {
  const found: TSESTree.Node[] = [];
  walk(children(node, keys), node, keys, stopAt, (child) => found.push(child));
  return found;
};

export const indexTree = (
  roots: readonly TSESTree.Node[],
  keys: VisitorKeys,
): { nodes: TSESTree.Node[]; parents: Map<TSESTree.Node, TSESTree.Node> } => {
  const nodes: TSESTree.Node[] = [];
  const parents = new Map<TSESTree.Node, TSESTree.Node>();

  walk(roots, undefined, keys, never, (node, parent) => {
    nodes.push(node);
    if (parent) parents.set(node, parent);
  });

  return { nodes, parents };
};

/** Every node under the roots, roots included. */
export const allNodes = (roots: readonly TSESTree.Node[], keys: VisitorKeys): TSESTree.Node[] =>
  indexTree(roots, keys).nodes;

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
