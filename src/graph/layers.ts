import { byText } from "../model";

export type Link = { from: string; to: string; imports: number; names: number };

export type Layering = { order: string[]; back: Link[]; approximate: boolean };

export const exactLimit = 20;

type Arc = readonly [node: number, weight: number];

const merge = (links: readonly Link[]): Link[] => [
  ...links
    .filter((link) => link.from !== link.to)
    .reduce((map, link) => {
      const key = `${link.from}\u0000${link.to}`;
      const known = map.get(key);

      return map.set(key, {
        from: link.from,
        to: link.to,
        imports: (known?.imports ?? 0) + link.imports,
        names: (known?.names ?? 0) + link.names,
      });
    }, new Map<string, Link>())
    .values(),
];

const exactOrder = (count: number, out: readonly (readonly Arc[])[]): number[] => {
  const size = 1 << count;
  const cost = new Float64Array(size).fill(Number.POSITIVE_INFINITY);
  const last = new Int8Array(size).fill(-1);

  cost[0] = 0;

  for (let set = 0; set < size; set++) {
    const base = cost[set] ?? Number.POSITIVE_INFINITY;

    for (let node = 0; node < count; node++) {
      const bit = 1 << node;

      if ((set & bit) !== 0) continue;

      let total = base;

      for (const [to, weight] of out[node] ?? []) if ((set & (1 << to)) !== 0) total += weight;

      if (total < (cost[set | bit] ?? Number.POSITIVE_INFINITY)) {
        cost[set | bit] = total;
        last[set | bit] = node;
      }
    }
  }

  const order: number[] = [];

  for (let set = size - 1; set > 0; set &= ~(1 << (last[set] ?? 0))) order.unshift(last[set] ?? 0);

  return order;
};

const heuristicOrder = (count: number, out: readonly (readonly Arc[])[], into: readonly (readonly Arc[])[]) => {
  const left = new Set(Array.from({ length: count }, (_, node) => node));
  const head: number[] = [];
  const tail: number[] = [];
  const weightIn = (arcs: readonly Arc[]) =>
    arcs.reduce((sum, [node, weight]) => sum + (left.has(node) ? weight : 0), 0);
  const peel = (): void => {
    const sinks = [...left].filter((node) => weightIn(out[node] ?? []) === 0);
    sinks.forEach((node) => left.delete(node));
    tail.unshift(...sinks.toReversed());

    const sources = [...left].filter((node) => weightIn(into[node] ?? []) === 0);
    sources.forEach((node) => left.delete(node));
    head.push(...sources);

    if (sinks.length + sources.length > 0) peel();
  };

  while (left.size > 0) {
    peel();

    const [chosen] = [...left].toSorted(
      (a, b) =>
        weightIn(out[b] ?? []) - weightIn(into[b] ?? []) - (weightIn(out[a] ?? []) - weightIn(into[a] ?? [])) || a - b,
    );

    if (chosen === undefined) break;

    left.delete(chosen);
    head.push(chosen);
  }

  return [...head, ...tail];
};

const reaches = (adjacency: ReadonlyMap<number, readonly number[]>, from: number, to: number): boolean => {
  const seen = new Set([from]);
  const stack = [from];

  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node === to) return true;

    (adjacency.get(node) ?? []).forEach((next) => {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    });
  }

  return false;
};

const topological = (count: number, arcs: readonly (readonly [number, number])[], rank: readonly number[]) => {
  const indegree = Array.from({ length: count }, () => 0);
  arcs.forEach(([, to]) => (indegree[to] = (indegree[to] ?? 0) + 1));

  const order: number[] = [];
  const ready = new Set(Array.from({ length: count }, (_, node) => node).filter((node) => indegree[node] === 0));

  while (ready.size > 0) {
    const [next = 0] = [...ready].toSorted((a, b) => (rank[a] ?? 0) - (rank[b] ?? 0));

    ready.delete(next);
    order.push(next);
    arcs.forEach(([from, to]) => {
      if (from !== next) return;

      indegree[to] = (indegree[to] ?? 0) - 1;
      if (indegree[to] === 0) ready.add(to);
    });
  }

  return order;
};

export const fewestBackLinks = (nodes: readonly string[], links: readonly Link[]): Layering => {
  const sorted = [...new Set(nodes)].toSorted(byText);
  const index = new Map(sorted.map((node, position) => [node, position]));
  const merged = merge(links).filter((link) => index.has(link.from) && index.has(link.to));
  const scale = 1 + merged.reduce((sum, link) => sum + link.names, 0);
  const weightOf = (link: Link) => link.imports * scale + link.names;
  const arcsOf = (end: "from" | "to") =>
    sorted.map((node) =>
      merged
        .filter((link) => link[end] === node)
        .map((link): Arc => [index.get(end === "from" ? link.to : link.from) ?? 0, weightOf(link)]),
    );
  const approximate = sorted.length > exactLimit;
  const first = approximate
    ? heuristicOrder(sorted.length, arcsOf("from"), arcsOf("to"))
    : exactOrder(sorted.length, arcsOf("from"));
  const position = Array.from({ length: sorted.length }, () => 0);
  first.forEach((node, at) => (position[node] = at));

  const numbered = merged.map((link) => ({ link, from: index.get(link.from) ?? 0, to: index.get(link.to) ?? 0 }));
  const isBack = (arc: { from: number; to: number }) => (position[arc.from] ?? 0) > (position[arc.to] ?? 0);
  const forward = numbered.filter((arc) => !isBack(arc));
  const adjacency = forward.reduce(
    (map, arc) => map.set(arc.from, [...(map.get(arc.from) ?? []), arc.to]),
    new Map<number, number[]>(),
  );
  const restored = approximate
    ? numbered
        .filter(isBack)
        .toSorted(
          (a, b) =>
            weightOf(b.link) - weightOf(a.link) || byText(a.link.from, b.link.from) || byText(a.link.to, b.link.to),
        )
        .filter((arc) => {
          if (reaches(adjacency, arc.to, arc.from)) return false;

          adjacency.set(arc.from, [...(adjacency.get(arc.from) ?? []), arc.to]);
          return true;
        })
    : [];
  const kept = [...forward, ...restored];
  const order = approximate
    ? topological(
        sorted.length,
        kept.map((arc) => [arc.from, arc.to] as const),
        position,
      )
    : first;

  return {
    order: order.map((node) => sorted[node] ?? ""),
    back: numbered
      .filter((arc) => !kept.includes(arc))
      .map((arc) => arc.link)
      .toSorted((a, b) => byText(a.from, b.from) || byText(a.to, b.to)),
    approximate,
  };
};
