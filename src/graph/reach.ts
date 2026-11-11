export type Reach = Map<string, string | null>;

export const breadthFirst = (starts: readonly string[], next: (node: string) => readonly string[]): Reach => {
  const seen: Reach = new Map(starts.map((start) => [start, null]));
  const queue = [...seen.keys()];

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head] ?? "";

    next(node).forEach((target) => {
      if (seen.has(target)) return;

      seen.set(target, node);
      queue.push(target);
    });
  }

  return seen;
};

export const chainTo = (reach: Reach, node: string): string[] => {
  const chain = [node];

  for (let parent = reach.get(node); parent !== null && parent !== undefined; parent = reach.get(parent)) {
    chain.push(parent);
  }

  return chain.toReversed();
};
