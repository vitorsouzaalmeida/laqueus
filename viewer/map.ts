import type { Area, GraphSnapshot, ModuleNode, Route, Side } from "../src/model";

export type Grouping = "areas" | "folders";
export type MapOptions = { grouping: Grouping; tray: ReadonlySet<Side> };

export type TreeNode = {
  id: string;
  kind: "root" | "side" | "area" | "subarea" | "folder";
  label: string;
  side: Side | null;
  parent: string | null;
  children: string[];
  moduleIds: string[];
  area: Area | null;
};

export type Tree = {
  root: TreeNode;
  nodes: Map<string, TreeNode>;
  pathOf: Map<string, string[]>;
};

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

export const mainSides: readonly Side[] = ["client", "shared", "server", "code"];
export const traySides: readonly Side[] = ["unreached", "test", "tooling"];
export const fileViewLimit = 80;

export const isTraySide = (value: unknown): value is Side => traySides.some((side) => side === value);

const folderLabel = (directory: string) => (directory === "." ? "(project root)" : directory);

export const buildTree = (data: GraphSnapshot, options: MapOptions): Tree => {
  const modules = data.modules;
  const visibleSides = data.lanes
    .map((lane) => lane.side)
    .filter((side) => mainSides.includes(side) || options.tray.has(side));
  const laneLabel = new Map(data.lanes.map((lane) => [lane.side, lane.label]));
  const areaById = new Map(data.areas.map((area) => [area.id, area]));
  const nodes = new Map<string, TreeNode>();
  const pathOf = new Map<string, string[]>();

  const add = (node: TreeNode) => {
    nodes.set(node.id, node);

    const parent = node.parent ? nodes.get(node.parent) : undefined;
    if (parent) parent.children.push(node.id);
  };

  const root: TreeNode = {
    id: "root",
    kind: "root",
    label: data.name,
    side: null,
    parent: null,
    children: [],
    moduleIds: modules.filter((module) => visibleSides.includes(module.placement.side)).map((module) => module.id),
    area: null,
  };

  add(root);

  visibleSides.forEach((side) => {
    const members = modules.filter((module) => module.placement.side === side);
    const sideId = `side:${side}`;

    add({
      id: sideId,
      kind: "side",
      label: laneLabel.get(side) ?? side,
      side,
      parent: "root",
      children: [],
      moduleIds: members.map((module) => module.id),
      area: null,
    });

    const useAreas = options.grouping === "areas" && mainSides.includes(side);
    const keyOf = (module: ModuleNode) => (useAreas && module.areaId ? module.areaId : module.groupId);
    const groups = [...new Set(members.map(keyOf))];

    groups.forEach((key) => {
      const groupMembers = members.filter((module) => keyOf(module) === key);
      const area = useAreas ? (areaById.get(key) ?? null) : null;
      const group = data.groups.find((candidate) => candidate.id === key);
      const groupId = `${area ? "area" : "folder"}:${side}:${key}`;

      add({
        id: groupId,
        kind: area ? "area" : "folder",
        label: area ? area.label : folderLabel(group?.directory ?? key),
        side,
        parent: sideId,
        children: [],
        moduleIds: groupMembers.map((module) => module.id),
        area,
      });

      const subKeys = area ? [...new Set(groupMembers.map((module) => module.subAreaId ?? ""))] : [];
      const subdivide = subKeys.length > 1 && subKeys.every((subKey) => subKey !== "");

      if (subdivide) {
        subKeys.forEach((subKey) => {
          const subMembers = groupMembers.filter((module) => module.subAreaId === subKey);
          const subArea = areaById.get(subKey) ?? null;
          const subId = `sub:${side}:${subKey}`;

          add({
            id: subId,
            kind: "subarea",
            label: subArea?.label ?? subKey,
            side,
            parent: groupId,
            children: [],
            moduleIds: subMembers.map((module) => module.id),
            area: subArea,
          });

          subMembers.forEach((module) => pathOf.set(module.id, ["root", sideId, groupId, subId]));
        });
      } else {
        groupMembers.forEach((module) => pathOf.set(module.id, ["root", sideId, groupId]));
      }
    });
  });

  return { root, nodes, pathOf };
};

export const ancestry = (tree: Tree, nodeId: string): string[] => {
  const node = tree.nodes.get(nodeId);
  return node?.parent ? [...ancestry(tree, node.parent), nodeId] : [nodeId];
};

export const deepestNode = (tree: Tree, moduleId: string) => {
  const path = tree.pathOf.get(moduleId);
  return path ? path[path.length - 1] : undefined;
};

export const viewMode = (node: TreeNode): "cards" | "files" =>
  node.kind === "root" || (node.children.length > 0 && node.moduleIds.length > fileViewLimit) ? "cards" : "files";

type Lookup = { module: (id: string) => ModuleNode | undefined };

const lookup = (data: GraphSnapshot): Lookup => {
  const modules = new Map(data.modules.map((module) => [module.id, module]));
  return { module: (id) => modules.get(id) };
};

const statsOf = (moduleIds: readonly string[], find: Lookup) => {
  const members = moduleIds.flatMap((id) => find.module(id) ?? []);
  const scores = members.flatMap((module) => (module.metrics.maxCC === null ? [] : [module.metrics.maxCC]));

  return {
    entries: members.filter((module) => module.placement.entry !== null).length,
    maxCC: scores.length > 0 ? Math.max(...scores) : null,
    cyclic: members.some((module) => module.metrics.cycleGroup !== null),
  };
};

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

const breadthFirst = (starts: readonly string[], next: (id: string) => readonly string[]) => {
  const visit = (
    frontier: readonly string[],
    seen: Map<string, { depth: number; origin: string | null }>,
  ): typeof seen => {
    if (frontier.length === 0) return seen;

    const discovered = frontier.flatMap((id) =>
      next(id)
        .filter((target) => !seen.has(target))
        .map((target) => {
          const parent = seen.get(id);
          const depth = (parent?.depth ?? 0) + 1;

          return [
            target,
            {
              depth,
              origin: depth === 1 ? target : (parent?.origin ?? null),
            },
          ] as const;
        }),
    );
    const fresh = [...new Map(discovered.toReversed())];

    fresh.forEach(([target, info]) => seen.set(target, info));

    return visit(
      fresh.map(([target]) => target),
      seen,
    );
  };
  return visit(starts, new Map(starts.map((id) => [id, { depth: 0, origin: null }])));
};

export const buildRouteView = (data: GraphSnapshot, tree: Tree, route: Route): RouteView => {
  const find = lookup(data);
  const outgoing = data.dependencyEdges.reduce(
    (map, edge) => map.set(edge.from, [...(map.get(edge.from) ?? []), edge.to]),
    new Map<string, string[]>(),
  );

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
  const outgoing = data.dependencyEdges.reduce(
    (map, edge) => map.set(edge.from, [...(map.get(edge.from) ?? []), edge.to]),
    new Map<string, string[]>(),
  );

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
