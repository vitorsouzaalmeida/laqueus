import { byText } from "../model";

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

type Frame = { node: string; order: number; low: number; next: number };

export const stronglyConnectedComponents = (nodes: readonly string[], adjacency: Adjacency): string[][] => {
  const index = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const components: string[][] = [];

  const popComponent = (root: string): string[] => {
    const component: string[] = [];

    for (let node = stack.pop(); ; node = stack.pop()) {
      if (node === undefined) throw new Error(`Component stack ran out before reaching ${root}`);

      onStack.delete(node);
      component.push(node);

      if (node === root) return component;
    }
  };

  const enter = (node: string): Frame => {
    const order = index.size;

    index.set(node, order);
    stack.push(node);
    onStack.add(node);

    return { node, order, low: order, next: 0 };
  };

  /** Visits a node and returns its low link. */
  const connect = (start: string): number => {
    const first = enter(start);
    const frames = [first];

    for (let frame = frames.at(-1); frame !== undefined; frame = frames.at(-1)) {
      const next = (adjacency.get(frame.node) ?? [])[frame.next];

      if (next !== undefined) {
        frame.next += 1;
        const seen = index.get(next);

        if (seen === undefined) frames.push(enter(next));
        else if (onStack.has(next)) frame.low = Math.min(frame.low, seen);

        continue;
      }

      frames.pop();

      if (frame.low === frame.order) components.push(popComponent(frame.node));

      const parent = frames.at(-1);

      if (parent) parent.low = Math.min(parent.low, frame.low);
    }

    return first.low;
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
      .toSorted(([a = ""], [b = ""]) => byText(a, b))
      .flatMap((component, group) => component.map((node) => [node, group] as const)),
  );

const outgoingOf = (edges: readonly Edge[], removed: ReadonlySet<number>): Map<string, number[]> => {
  const outgoing = new Map<string, number[]>();

  edges.forEach((edge, at) => {
    if (edge.from === edge.to || removed.has(at)) return;

    const known = outgoing.get(edge.from);

    if (known) known.push(at);
    else outgoing.set(edge.from, [at]);
  });

  return outgoing;
};

const acyclic = (edges: readonly Edge[], removed: ReadonlySet<number>): boolean => {
  const outgoing = outgoingOf(edges, removed);
  const indegree = new Map<string, number>();

  outgoing.forEach((list) =>
    list.forEach((at) => {
      const to = edges[at]?.to ?? "";
      indegree.set(to, (indegree.get(to) ?? 0) + 1);
    }),
  );

  const ready = [...outgoing.keys()].filter((node) => !indegree.has(node));
  let left = indegree.size;

  for (let node = ready.pop(); node !== undefined; node = ready.pop()) {
    (outgoing.get(node) ?? []).forEach((at) => {
      const to = edges[at]?.to ?? "";
      const count = (indegree.get(to) ?? 0) - 1;

      indegree.set(to, count);

      if (count === 0) {
        left -= 1;
        ready.push(to);
      }
    });
  }

  return left === 0;
};

const cycleThrough = (
  start: string,
  edges: readonly Edge[],
  outgoing: ReadonlyMap<string, number[]>,
  limit: number,
) => {
  const via = new Map<string, number>();
  const depth = new Map([[start, 0]]);
  const queue = [start];

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] ?? start;
    const steps = (depth.get(node) ?? 0) + 1;

    if (steps >= limit) return undefined;

    for (const at of outgoing.get(node) ?? []) {
      const to = edges[at]?.to ?? start;

      if (to === start) {
        const cycle = [at];

        for (let back = node; back !== start; back = edges[via.get(back) ?? -1]?.from ?? start) {
          cycle.push(via.get(back) ?? -1);
        }

        return cycle.toReversed();
      }

      if (!depth.has(to)) {
        depth.set(to, steps);
        via.set(to, at);
        queue.push(to);
      }
    }
  }

  return undefined;
};

const shortestCycle = (nodes: readonly string[], edges: readonly Edge[], removed: ReadonlySet<number>) => {
  const outgoing = outgoingOf(edges, removed);
  let best: number[] | undefined;

  for (const start of nodes) {
    if (best?.length === 2) break;

    best = cycleThrough(start, edges, outgoing, best?.length ?? Number.POSITIVE_INFINITY) ?? best;
  }

  return best;
};

export const largestCut = 2;
const cutBudget = 20000;

const byIndices = (a: readonly number[], b: readonly number[]) =>
  a.reduce((order, value, at) => order || value - (b[at] ?? 0), 0) || a.length - b.length;

export const smallestCuts = <E extends Edge>(nodes: readonly string[], edges: readonly E[]): E[][] => {
  const first = shortestCycle(nodes, edges, new Set());

  if (first === undefined) return [];

  const pick = (cuts: readonly (readonly number[])[]) =>
    cuts.toSorted(byIndices).map((cut) => cut.flatMap((at) => edges[at] ?? []));

  const singles = first.filter((at) => acyclic(edges, new Set([at]))).map((at) => [at]);

  if (singles.length > 0) return pick(singles);

  const seconds = first.map((at) => ({ at, cycle: shortestCycle(nodes, edges, new Set([at])) ?? [] }));
  const checks = seconds.reduce((total, { cycle }) => total + cycle.length, 0);

  if (checks > cutBudget) return [];

  const pairs = new Map(
    seconds.flatMap(({ at, cycle }) =>
      cycle
        .filter((other) => acyclic(edges, new Set([at, other])))
        .map((other) => {
          const pair = [Math.min(at, other), Math.max(at, other)];
          return [pair.join(","), pair] as const;
        }),
    ),
  );

  return pick([...pairs.values()]);
};
