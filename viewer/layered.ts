export type Point = { x: number; y: number };
export type LayoutNode = { id: string; width: number; height: number; rank?: "top" | "bottom" };
export type LayoutEdge = { from: string; to: string; count?: number };
export type LayeredOptions = { maxPerRow: number; gapX: number; gapY: number };

const acyclicEdges = (ids: readonly string[], edges: readonly LayoutEdge[]): LayoutEdge[] => {
  const weight = (edge: LayoutEdge) => edge.count ?? 1;
  const balance = edges.reduce(
    (map, edge) => map.set(edge.from, (map.get(edge.from) ?? 0) + weight(edge)).set(edge.to, (map.get(edge.to) ?? 0) - weight(edge)),
    new Map<string, number>(),
  );
  const outgoing = edges.reduce(
    (map, edge) => map.set(edge.from, [...(map.get(edge.from) ?? []), edge]),
    new Map<string, LayoutEdge[]>(),
  );
  const order = ids
    .map((id, position) => ({ id, position, balance: balance.get(id) ?? 0 }))
    .sort((a, b) => b.balance - a.balance || a.position - b.position)
    .map((entry) => entry.id);
  const done = new Set<string>();
  const active = new Set<string>();
  const kept: LayoutEdge[] = [];
  const visit = (node: string): void => {
    active.add(node);
    [...(outgoing.get(node) ?? [])]
      .sort((a, b) => weight(b) - weight(a))
      .forEach((edge) => {
        if (active.has(edge.to)) return;
        kept.push(edge);
        if (!done.has(edge.to)) visit(edge.to);
      });
    active.delete(node);
    done.add(node);
  };
  order.forEach((id) => {
    if (!done.has(id)) visit(id);
  });
  return kept;
};

const longestPathLayers = (ids: readonly string[], edges: readonly LayoutEdge[]) => {
  const predecessors = acyclicEdges(ids, edges).reduce(
    (map, edge) => map.set(edge.to, [...(map.get(edge.to) ?? []), edge.from]),
    new Map<string, string[]>(),
  );
  const memo = new Map<string, number>();
  const layerOf = (node: string): number => {
    const cached = memo.get(node);
    if (cached !== undefined) return cached;
    const value = Math.max(-1, ...(predecessors.get(node) ?? []).map(layerOf)) + 1;
    memo.set(node, value);
    return value;
  };
  return new Map(ids.map((id) => [id, layerOf(id)]));
};

const orderLayers = (layers: readonly string[][], edges: readonly LayoutEdge[]): string[][] => {
  const neighbours = edges.reduce(
    (map, edge) =>
      map
        .set(edge.from, [...(map.get(edge.from) ?? []), edge.to])
        .set(edge.to, [...(map.get(edge.to) ?? []), edge.from]),
    new Map<string, string[]>(),
  );
  const sweep = (current: readonly string[][], iteration: number): string[][] => {
    if (iteration === 0) return current.map((layer) => [...layer]);
    const position = new Map(
      current.flatMap((layer) => layer.map((id, index) => [id, (index + 0.5) / layer.length] as const)),
    );
    const reordered = current.map((layer) =>
      layer
        .map((id, index) => {
          const around = (neighbours.get(id) ?? []).flatMap((other) => position.get(other) ?? []);
          const centre =
            around.length === 0
              ? (index + 0.5) / layer.length
              : around.reduce((sum, value) => sum + value, 0) / around.length;
          return { id, centre, index };
        })
        .sort((a, b) => a.centre - b.centre || a.index - b.index)
        .map((entry) => entry.id),
    );
    return sweep(reordered, iteration - 1);
  };
  return sweep(layers, 6);
};

export const layered = (
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: LayeredOptions,
): Map<string, Point> => {
  const ids = nodes.map((node) => node.id);
  const rankOf = new Map(nodes.map((node) => [node.id, node.rank]));
  const usable = edges.filter((edge) => rankOf.has(edge.from) && rankOf.has(edge.to) && edge.from !== edge.to);
  const base = longestPathLayers(
    ids.filter((id) => !rankOf.get(id)),
    usable.filter((edge) => !rankOf.get(edge.from) && !rankOf.get(edge.to)),
  );
  const deepest = Math.max(0, ...base.values());
  const layerOf = (node: LayoutNode) =>
    node.rank === "top" ? 0 : node.rank === "bottom" ? deepest + 2 : (base.get(node.id) ?? 0) + 1;
  const grouped = nodes.reduce(
    (map, node) => map.set(layerOf(node), [...(map.get(layerOf(node)) ?? []), node.id]),
    new Map<number, string[]>(),
  );
  const layers = [...grouped].sort(([a], [b]) => a - b).map(([, members]) => members);
  const rows = orderLayers(layers, usable).flatMap((layer) =>
    Array.from({ length: Math.ceil(layer.length / options.maxPerRow) }, (_, row) =>
      layer.slice(row * options.maxPerRow, (row + 1) * options.maxPerRow),
    ),
  );
  const size = new Map(nodes.map((node) => [node.id, node]));
  return rows.reduce(
    (state, row) => {
      const widths = row.map((id) => size.get(id)?.width ?? 0);
      const height = Math.max(0, ...row.map((id) => size.get(id)?.height ?? 0));
      const total = widths.reduce((sum, width) => sum + width, 0) + options.gapX * Math.max(0, row.length - 1);
      row.reduce((x, id, index) => {
        const width = widths[index] ?? 0;
        state.positions.set(id, { x: x + width / 2, y: state.y + height / 2 });
        return x + width + options.gapX;
      }, -total / 2);
      return { y: state.y + height + options.gapY, positions: state.positions };
    },
    { y: 0, positions: new Map<string, Point>() },
  ).positions;
};
