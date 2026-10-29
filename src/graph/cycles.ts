export type Edge = { readonly from: string; readonly to: string };

export type Adjacency = ReadonlyMap<string, readonly string[]>;

export const setsBy = (pairs: readonly (readonly [string, string])[]): Map<string, Set<string>> =>
  pairs.reduce(
    (map, [key, value]) => map.set(key, (map.get(key) ?? new Set<string>()).add(value)),
    new Map<string, Set<string>>(),
  );

export const adjacencyOf = (edges: readonly Edge[]): Adjacency =>
  new Map(
    [...setsBy(edges.map((edge) => [edge.from, edge.to] as const))].map(([key, values]) => [key, [...values]] as const),
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

export const cycleGroups = (nodes: readonly string[], edges: readonly Edge[]): Map<string, number> =>
  new Map(
    stronglyConnectedComponents(nodes, adjacencyOf(edges.filter((edge) => edge.from !== edge.to)))
      .filter((component) => component.length > 1)
      .map((component) => component.toSorted())
      .toSorted(([a = ""], [b = ""]) => a.localeCompare(b))
      .flatMap((component, group) => component.map((node) => [node, group] as const)),
  );

const binomial = (n: number, k: number): number =>
  k === 0 ? 1 : k > n ? 0 : Array.from({ length: k }, (_, i) => (n - i) / (i + 1)).reduce((a, b) => a * b, 1);

const combinations = <T>(items: readonly T[], size: number): T[][] =>
  size === 0
    ? [[]]
    : items.flatMap((item, index) => combinations(items.slice(index + 1), size - 1).map((rest) => [item, ...rest]));

export const largestCut = 2;
const cutBudget = 20000;

export const smallestCuts = <E extends Edge>(nodes: readonly string[], edges: readonly E[]): E[][] => {
  const search = (size: number): E[][] => {
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
