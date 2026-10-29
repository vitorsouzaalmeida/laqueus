import { type Edge, adjacencyOf, stronglyConnectedComponents } from "./cycles";

export type Visibility = { fanIn: number; fanOut: number };

const forEachBit = (words: Uint32Array, visit: (index: number) => void) => {
  for (let slot = 0; slot < words.length; slot++) {
    for (let word = words[slot] ?? 0; word !== 0; word &= word - 1) {
      visit(slot * 32 + 31 - Math.clz32(word & -word));
    }
  }
};

export const visibility = (nodes: readonly string[], edges: readonly Edge[]): Map<string, Visibility> => {
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
