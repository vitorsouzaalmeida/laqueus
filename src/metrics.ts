import type { TSESTree } from "@typescript-eslint/types";
import { type VisitorKeys, descendants, isFunction } from "./ast";
import { excessFrom } from "./judgement";
import type { DependencyEdge, FunctionNode, ModuleMetrics } from "./model";

const logicalAssignments = new Set(["&&=", "||="]);
const templateBranches = new Set(["SvelteIfBlock", "SvelteEachBlock", "SvelteAwaitBlock", "SvelteAwaitCatchBlock"]);
const ownedApart = new Set(["ClassBody", "SvelteSnippetBlock"]);

export const branchWeight = (node: TSESTree.Node): number => {
  if (templateBranches.has(node.type)) return 1;

  switch (node.type) {
    case "IfStatement":
    case "ForStatement":
    case "ForInStatement":
    case "ForOfStatement":
    case "WhileStatement":
    case "DoWhileStatement":
    case "CatchClause":
    case "ConditionalExpression":
      return 1;
    case "SwitchCase":
      return node.test ? 1 : 0;
    default:
      return 0;
  }
};

export const conditionWeight = (node: TSESTree.Node): number => {
  switch (node.type) {
    case "LogicalExpression":
      return node.operator === "??" ? 0 : 1;
    case "AssignmentExpression":
      return logicalAssignments.has(node.operator) ? 1 : 0;
    default:
      return 0;
  }
};

export const decisionWeight = (node: TSESTree.Node): number => branchWeight(node) + conditionWeight(node);

export const isOwnershipBoundary = (node: TSESTree.Node) => isFunction(node) || ownedApart.has(node.type);

export const ownNodes = (fn: TSESTree.Node, keys: VisitorKeys): TSESTree.Node[] =>
  descendants(fn, keys, isOwnershipBoundary).filter((node) => !isOwnershipBoundary(node));

export const decisionsIn = (node: TSESTree.Node | null | undefined, keys: VisitorKeys): number =>
  !node || isOwnershipBoundary(node)
    ? 0
    : [node, ...ownNodes(node, keys)].reduce((total, child) => total + decisionWeight(child), 0);

const sumOver = (nodes: readonly TSESTree.Node[], weight: (node: TSESTree.Node) => number) =>
  nodes.reduce((total, node) => total + weight(node), 0);

export const cyclomaticComplexity = (fn: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(ownNodes(fn, keys), decisionWeight);

export const branchComplexity = (fn: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(ownNodes(fn, keys), branchWeight);

export const inclusiveComplexity = (node: TSESTree.Node, keys: VisitorKeys): number =>
  1 + sumOver(descendants(node, keys), decisionWeight);

export type Measures = { complexity: number; branches: number; inclusive: number };

export const measureTemplate = (roots: readonly TSESTree.Node[], keys: VisitorKeys): Measures => {
  const own = roots.flatMap((root) => (isOwnershipBoundary(root) ? [] : [root, ...ownNodes(root, keys)]));
  const all = roots.flatMap((root) => [root, ...descendants(root, keys)]);

  return {
    complexity: 1 + sumOver(own, decisionWeight),
    branches: 1 + sumOver(own, branchWeight),
    inclusive: 1 + sumOver(all, decisionWeight),
  };
};

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

export const stronglyConnectedComponents = (nodes: readonly string[], adjacency: Adjacency): string[][] => {
  const index = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const popComponent = (root: string): string[] => {
    const node = stack.pop();

    if (node === undefined) throw new Error(`Component stack ran out before reaching ${root}`);

    onStack.delete(node);

    return node === root ? [node] : [node, ...popComponent(root)];
  };

  /** Visits a node and returns its low link. */
  const connect = (node: string): number => {
    const order = index.size;

    index.set(node, order);
    stack.push(node);
    onStack.add(node);

    const lowLink = (adjacency.get(node) ?? []).reduce((low, next) => {
      const seen = index.get(next);

      if (seen === undefined) return Math.min(low, connect(next));

      return onStack.has(next) ? Math.min(low, seen) : low;
    }, order);

    if (lowLink === order) components.push(popComponent(node));

    return lowLink;
  };

  nodes.forEach((node) => {
    if (!index.has(node)) connect(node);
  });

  return components;
};

export const cycleGroups = (nodes: readonly string[], edges: readonly DependencyEdge[]): Map<string, number> =>
  new Map(
    stronglyConnectedComponents(nodes, adjacencyOf(edges.filter((edge) => edge.from !== edge.to)))
      .filter((component) => component.length > 1)
      .map((component) => component.toSorted())
      .toSorted(([a = ""], [b = ""]) => a.localeCompare(b))
      .flatMap((component, group) => component.map((node) => [node, group] as const)),
  );

export type Visibility = { fanIn: number; fanOut: number };

const forEachBit = (words: Uint32Array, visit: (index: number) => void) => {
  for (let slot = 0; slot < words.length; slot++) {
    for (let word = words[slot] ?? 0; word !== 0; word &= word - 1) {
      visit(slot * 32 + 31 - Math.clz32(word & -word));
    }
  }
};

export const visibility = (nodes: readonly string[], edges: readonly DependencyEdge[]): Map<string, Visibility> => {
  const adjacency = adjacencyOf(edges.filter((edge) => edge.from !== edge.to));
  const components = stronglyConnectedComponents(nodes, adjacency);
  const position = new Map(nodes.map((node, index) => [node, index]));
  const componentOf = new Map(
    components.flatMap((component, index) => component.map((node) => [node, index] as const)),
  );
  const words = Math.ceil(nodes.length / 32);
  const reach: Uint32Array[] = [];

  components.forEach((component, index) => {
    const bits = new Uint32Array(words);

    component.forEach((node) => {
      const at = position.get(node) ?? 0;
      bits[at >>> 5] = (bits[at >>> 5] ?? 0) | (1 << (at & 31));

      (adjacency.get(node) ?? []).forEach((next) => {
        const other = componentOf.get(next);
        const theirs = other === undefined || other === index ? undefined : reach[other];

        theirs?.forEach((word, slot) => {
          bits[slot] = (bits[slot] ?? 0) | word;
        });
      });
    });

    reach.push(bits);
  });

  const fanIn = Array.from({ length: nodes.length }, () => 0);
  const fanOut = reach.map((bits, index) => {
    const size = components[index]?.length ?? 0;
    let count = 0;

    forEachBit(bits, (at) => {
      fanIn[at] = (fanIn[at] ?? 0) + size;
      count += 1;
    });

    return count;
  });

  return new Map(
    nodes.map(
      (node, at) => [node, { fanIn: fanIn[at] ?? 1, fanOut: fanOut[componentOf.get(node) ?? -1] ?? 1 }] as const,
    ),
  );
};

export const decisionsOf = (scores: readonly number[]) => scores.reduce((sum, score) => sum + score - 1, 0);

export const excessOf = (scores: readonly number[]) =>
  scores.reduce((sum, score) => sum + Math.max(0, score - excessFrom), 0);

export const moduleMetrics = (
  moduleIds: readonly string[],
  edges: readonly DependencyEdge[],
  functionsByModule: ReadonlyMap<string, readonly FunctionNode[]>,
): Map<string, ModuleMetrics> => {
  const cycles = cycleGroups(moduleIds, edges);
  const reach = visibility(moduleIds, edges);
  const external = edges.filter((edge) => edge.from !== edge.to);
  const importers = groupBy(external.map((edge) => [edge.to, edge.from] as const));
  const imported = groupBy(external.map((edge) => [edge.from, edge.to] as const));

  return new Map(
    moduleIds.map((id) => {
      const scores = (functionsByModule.get(id) ?? []).map((fn) => fn.complexity);

      return [
        id,
        {
          fanIn: importers.get(id)?.size ?? 0,
          fanOut: imported.get(id)?.size ?? 0,
          visibilityFanIn: reach.get(id)?.fanIn ?? 1,
          visibilityFanOut: reach.get(id)?.fanOut ?? 1,
          maxCC: scores.length > 0 ? scores.reduce((max, score) => Math.max(max, score), 0) : null,
          decisions: decisionsOf(scores),
          excessCC: excessOf(scores),
          functionCount: scores.length,
          cycleGroup: cycles.get(id) ?? null,
        },
      ];
    }),
  );
};

const binomial = (n: number, k: number): number =>
  k === 0 ? 1 : k > n ? 0 : Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1);

const combinations = <T>(items: readonly T[], size: number): T[][] =>
  size === 0
    ? [[]]
    : items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));

export const largestCut = 2;
const cutBudget = 20000;

export const smallestCuts = (nodes: readonly string[], edges: readonly DependencyEdge[]): DependencyEdge[][] => {
  const search = (size: number): DependencyEdge[][] => {
    if (size > largestCut || size > edges.length || binomial(edges.length, size) > cutBudget) return [];

    const cuts = combinations(edges, size).filter(
      (cut) =>
        cycleGroups(
          nodes,
          edges.filter((edge) => !cut.includes(edge)),
        ).size === 0,
    );

    return cuts.length > 0 ? cuts : search(size + 1);
  };

  return search(1);
};
