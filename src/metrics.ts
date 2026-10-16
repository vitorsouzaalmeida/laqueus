import { type AstNode, type VisitorKeys, descendants, isFunction, stringField } from "./ast";
import type { DependencyEdge, FunctionNode, ModuleMetrics } from "./model";

const alwaysBranching = new Set([
  "IfStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "CatchClause",
  "ConditionalExpression",
  "LogicalExpression",
  "AssignmentPattern",
]);

const logicalAssignments = new Set(["&&=", "||=", "??="]);

export const decisionWeight = (node: AstNode): number =>
  alwaysBranching.has(node.type)
    ? 1
    : node.type === "SwitchCase"
      ? node.test
        ? 1
        : 0
      : node.type === "AssignmentExpression"
        ? logicalAssignments.has(stringField(node, "operator") ?? "")
          ? 1
          : 0
        : (node.type === "MemberExpression" || node.type === "CallExpression") &&
            node.optional === true
          ? 1
          : 0;

export const isOwnershipBoundary = (node: AstNode) => isFunction(node) || node.type === "ClassBody";

export const ownNodes = (fn: AstNode, keys: VisitorKeys): AstNode[] =>
  descendants(fn, keys, isOwnershipBoundary).filter((node) => !isOwnershipBoundary(node));

export const decisionsIn = (node: AstNode | undefined, keys: VisitorKeys): number =>
  !node || isOwnershipBoundary(node)
    ? 0
    : [node, ...descendants(node, keys, isOwnershipBoundary).filter((child) => !isOwnershipBoundary(child))].reduce(
        (total, child) => total + decisionWeight(child),
        0,
      );

export const cyclomaticComplexity = (fn: AstNode, keys: VisitorKeys): number =>
  ownNodes(fn, keys).reduce((total, node) => total + decisionWeight(node), 1);

type Adjacency = ReadonlyMap<string, readonly string[]>;

const groupBy = (pairs: readonly (readonly [string, string])[]): Map<string, Set<string>> =>
  pairs.reduce(
    (map, [key, value]) => map.set(key, (map.get(key) ?? new Set<string>()).add(value)),
    new Map<string, Set<string>>(),
  );

const adjacencyOf = (edges: readonly DependencyEdge[]): Adjacency =>
  new Map(
    [...groupBy(edges.map((edge) => [edge.from, edge.to] as const))].map(
      ([key, values]) => [key, [...values]] as const,
    ),
  );

export const stronglyConnectedComponents = (
  nodes: readonly string[],
  adjacency: Adjacency,
): string[][] => {
  const index = new Map<string, number>();
  const lowLink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const popComponent = (root: string): string[] => {
    const node = stack.pop() as string;
    onStack.delete(node);
    return node === root ? [node] : [node, ...popComponent(root)];
  };

  const connect = (node: string): void => {
    index.set(node, index.size);
    lowLink.set(node, index.get(node) as number);
    stack.push(node);
    onStack.add(node);
    (adjacency.get(node) ?? []).forEach((next) => {
      if (!index.has(next)) {
        connect(next);
        lowLink.set(node, Math.min(lowLink.get(node) as number, lowLink.get(next) as number));
      } else if (onStack.has(next)) {
        lowLink.set(node, Math.min(lowLink.get(node) as number, index.get(next) as number));
      }
    });
    if (lowLink.get(node) === index.get(node)) components.push(popComponent(node));
  };

  nodes.forEach((node) => {
    if (!index.has(node)) connect(node);
  });
  return components;
};

export const weaklyConnectedComponents = (
  nodes: readonly string[],
  edges: readonly DependencyEdge[],
): Map<string, number> => {
  const neighbours = groupBy(
    edges.flatMap((edge) => [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ]),
  );
  const visit = (node: string, island: number, seen: Map<string, number>): Map<string, number> =>
    seen.has(node)
      ? seen
      : [...(neighbours.get(node) ?? [])].reduce(
          (acc, next) => visit(next, island, acc),
          seen.set(node, island),
        );
  return nodes.reduce(
    (state, node) =>
      state.seen.has(node)
        ? state
        : { seen: visit(node, state.count, state.seen), count: state.count + 1 },
    { seen: new Map<string, number>(), count: 0 },
  ).seen;
};

export const cycleGroups = (
  nodes: readonly string[],
  edges: readonly DependencyEdge[],
): Map<string, number> => {
  const selfLoops = new Set(edges.filter((edge) => edge.from === edge.to).map((edge) => edge.from));
  return new Map(
    stronglyConnectedComponents(nodes, adjacencyOf(edges))
      .filter((component) => component.length > 1 || selfLoops.has(component[0] as string))
      .map((component) => [...component].sort())
      .sort((a, b) => (a[0] as string).localeCompare(b[0] as string))
      .flatMap((component, group) => component.map((node) => [node, group] as const)),
  );
};

export const moduleMetrics = (
  moduleIds: readonly string[],
  edges: readonly DependencyEdge[],
  functionsByModule: ReadonlyMap<string, readonly FunctionNode[]>,
): Map<string, ModuleMetrics> => {
  const cycles = cycleGroups(moduleIds, edges);
  const islands = weaklyConnectedComponents(moduleIds, edges);
  const external = edges.filter((edge) => edge.from !== edge.to);
  const importers = groupBy(external.map((edge) => [edge.to, edge.from] as const));
  const imported = groupBy(external.map((edge) => [edge.from, edge.to] as const));
  return new Map(
    moduleIds.map((id) => {
      const scores = (functionsByModule.get(id) ?? []).map((fn) => fn.complexity);
      const total = scores.reduce((sum, score) => sum + score, 0);
      return [
        id,
        {
          fanIn: importers.get(id)?.size ?? 0,
          fanOut: imported.get(id)?.size ?? 0,
          maxCC: scores.length > 0 ? scores.reduce((max, score) => Math.max(max, score), 0) : null,
          meanCC: scores.length > 0 ? Math.round((total / scores.length) * 100) / 100 : null,
          functionCount: scores.length,
          cycleGroup: cycles.get(id) ?? null,
          island: islands.get(id) ?? 0,
        },
      ];
    }),
  );
};
