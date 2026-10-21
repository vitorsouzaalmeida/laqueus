import type { GraphSnapshot, ModuleNode, Route, Side } from "../src/model";
import { type Tree, type TreeNode, breadthFirst, deepestNode, ancestry, nodeStats, outgoingImports } from "../src/tree";

export type MapItem = {
  id: string;
  kind: "group" | "file" | "stub";
  label: string;
  side: Side | null;
  target: string | null;
  moduleIds: string[];
  entries: number;
  maxCC: number | null;
  cyclic: boolean;
  column: number;
};

export type MapLink = { id: string; from: string; to: string; count: number };

export type MapView = {
  mode: "cards" | "files";
  items: MapItem[];
  links: MapLink[];
};

export const fileViewLimit = 80;

export const viewMode = (node: TreeNode): "cards" | "files" =>
  node.kind === "root" || (node.children.length > 0 && node.moduleIds.length > fileViewLimit) ? "cards" : "files";

type Lookup = { module: (id: string) => ModuleNode | undefined };

const lookup = (data: GraphSnapshot): Lookup => {
  const modules = new Map(data.modules.map((module) => [module.id, module]));
  return { module: (id) => modules.get(id) };
};

const statsOf = (moduleIds: readonly string[], find: Lookup) =>
  nodeStats(moduleIds.flatMap((id) => find.module(id) ?? []));

const fileItem = (module: ModuleNode, id = module.id, column = 0): MapItem => ({
  id,
  kind: "file",
  label: module.path.slice(module.path.lastIndexOf("/") + 1),
  side: module.placement.side,
  target: null,
  moduleIds: [module.id],
  entries: module.placement.entry === null ? 0 : 1,
  maxCC: module.metrics.maxCC,
  cyclic: module.metrics.cycleGroup !== null,
  column,
});

const groupItem = (node: TreeNode, find: Lookup, kind: "group" | "stub", column = 0): MapItem => ({
  id: kind === "stub" ? `stub:${node.id}` : node.id,
  kind,
  label: node.label,
  side: node.side,
  target: node.id,
  moduleIds: node.moduleIds,
  column,
  ...statsOf(node.moduleIds, find),
});

const aggregateLinks = (pairs: readonly (readonly [string, string])[]): MapLink[] => [
  ...pairs
    .reduce((map, [from, to]) => {
      const id = `link:${from}->${to}`;
      return map.set(id, { id, from, to, count: (map.get(id)?.count ?? 0) + 1 });
    }, new Map<string, MapLink>())
    .values(),
];

export const buildView = (data: GraphSnapshot, tree: Tree, nodeId: string): MapView => {
  const node = tree.nodes.get(nodeId) ?? tree.root;
  const find = lookup(data);
  const mode = viewMode(node);
  const scope = ancestry(tree, node.id);
  const depth = scope.length;

  const itemOf = (moduleId: string): string | undefined => {
    const path = tree.pathOf.get(moduleId);

    if (!path) return undefined;

    const inside = scope.every((id, index) => path[index] === id);

    if (inside) return mode === "files" ? moduleId : path[depth];

    const divergence = path.findIndex((id, index) => scope[index] !== id);

    return `stub:${path[divergence]}`;
  };

  const pairs = data.dependencyEdges.flatMap((edge) => {
    const from = itemOf(edge.from);
    const to = itemOf(edge.to);

    return from && to && from !== to && !(from.startsWith("stub:") && to.startsWith("stub:"))
      ? [[from, to] as const]
      : [];
  });
  const links = aggregateLinks(pairs);
  const inner =
    mode === "files"
      ? node.moduleIds.flatMap((id) => {
          const module = find.module(id);
          return module ? [fileItem(module)] : [];
        })
      : node.children.flatMap((id) => {
          const child = tree.nodes.get(id);
          return child ? [groupItem(child, find, "group")] : [];
        });
  const stubIds = [...new Set(links.flatMap((link) => [link.from, link.to]).filter((id) => id.startsWith("stub:")))];
  const stubs = stubIds.flatMap((id) => {
    const target = tree.nodes.get(id.slice("stub:".length));
    return target ? [groupItem(target, find, "stub")] : [];
  });

  return { mode, items: [...inner, ...stubs], links };
};

export type RouteView = MapView & {
  reach: Record<"client" | "server", string[]>;
};

export const buildRouteView = (data: GraphSnapshot, tree: Tree, route: Route): RouteView => {
  const find = lookup(data);
  const outgoing = outgoingImports(data);

  /** Files three levels deep (root › side › group) are summarised by their group. */
  const groupKey = (module: ModuleNode) =>
    tree.pathOf.get(module.id)?.[2] ?? deepestNode(tree, module.id) ?? module.groupId;

  const columnOf = (side: "client" | "server", column: number) => {
    const starts = route.files.filter((file) => file.side === side).map((file) => file.moduleId);
    const reach = breadthFirst(starts, (id) => outgoing.get(id) ?? []);
    const prefix = `${side}:`;

    const files = [...reach].filter(([, info]) => info.depth <= 1);
    const deeper = [...reach].filter(([, info]) => info.depth > 1);
    const fileItems = files.flatMap(([id]) => {
      const module = find.module(id);
      return module ? [fileItem(module, `${prefix}${id}`, column)] : [];
    });
    const cards = [
      ...new Set(
        deeper.flatMap(([id]) => {
          const module = find.module(id);
          return module ? [groupKey(module)] : [];
        }),
      ),
    ].flatMap((key) => {
      const members = deeper.filter(([id]) => {
        const module = find.module(id);
        return module && groupKey(module) === key;
      });
      const node = tree.nodes.get(key);
      const moduleIds = members.map(([id]) => id);

      return [
        {
          id: `${prefix}card:${key}`,
          kind: "group" as const,
          label: node?.label ?? key,
          side: node?.side ?? null,
          target: node ? node.id : null,
          moduleIds,
          column,
          ...statsOf(moduleIds, find),
        },
      ];
    });

    const cardOf = (id: string) => {
      const module = find.module(id);
      return module ? `${prefix}card:${groupKey(module)}` : undefined;
    };

    const pairs = [
      ...files
        .filter(([, info]) => info.depth === 1)
        .flatMap(([id]) =>
          starts
            .filter((start) => (outgoing.get(start) ?? []).includes(id))
            .map((start) => [`${prefix}${start}`, `${prefix}${id}`] as const),
        ),
      ...deeper.flatMap(([id, info]) => {
        const card = cardOf(id);
        return card && info.origin ? [[`${prefix}${info.origin}`, card] as const] : [];
      }),
    ];

    return {
      items: [...fileItems, ...cards],
      links: aggregateLinks(pairs),
      reach: [...reach.keys()],
    };
  };

  const client = columnOf("client", 0);
  const server = columnOf("server", 1);

  return {
    mode: "files",
    items: [...client.items, ...server.items],
    links: [...client.links, ...server.links],
    reach: { client: client.reach, server: server.reach },
  };
};

export const shortestPath = (data: GraphSnapshot, from: string, to: string): string[] | null => {
  const outgoing = outgoingImports(data);

  const search = (frontier: readonly string[], parents: Map<string, string | null>): Map<string, string | null> => {
    if (frontier.length === 0 || parents.has(to)) return parents;

    const next = frontier.flatMap((id) =>
      (outgoing.get(id) ?? []).filter((target) => !parents.has(target)).map((target) => [target, id] as const),
    );
    const fresh = [...new Map(next.toReversed())];

    fresh.forEach(([target, parent]) => parents.set(target, parent));

    return search(
      fresh.map(([target]) => target),
      parents,
    );
  };

  const parents = search([from], new Map([[from, null]]));

  if (!parents.has(to)) return null;

  const chain = (id: string): string[] => {
    const parent = parents.get(id);
    return parent ? [...chain(parent), id] : [id];
  };

  return chain(to);
};

export const pathView = (data: GraphSnapshot, ids: readonly string[]): MapView => {
  const find = lookup(data);
  return {
    mode: "files",
    items: ids.flatMap((id) => {
      const module = find.module(id);
      return module ? [fileItem(module)] : [];
    }),
    links: ids.flatMap((from, index) => {
      const to = ids[index + 1];
      return to === undefined ? [] : [{ id: `link:${from}->${to}`, from, to, count: 1 }];
    }),
  };
};
