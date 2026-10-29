export type Reach = Map<string, string | null>;

export const breadthFirst = (starts: readonly string[], next: (node: string) => readonly string[]): Reach => {
  const visit = (frontier: readonly string[], seen: Reach): Reach => {
    if (frontier.length === 0) return seen;

    const discovered = frontier.flatMap((node) =>
      next(node)
        .filter((target) => !seen.has(target))
        .map((target) => [target, node] as const),
    );
    const fresh = [...new Map(discovered.toReversed())];

    fresh.forEach(([target, parent]) => seen.set(target, parent));

    return visit(
      fresh.map(([target]) => target),
      seen,
    );
  };
  return visit(starts, new Map(starts.map((start) => [start, null])));
};

export const chainTo = (reach: Reach, node: string): string[] => {
  const parent = reach.get(node);
  return parent === null || parent === undefined ? [node] : [...chainTo(reach, parent), node];
};
