import { type Area, type GraphSnapshot, type ModuleNode, type Result, type Route, type Side, err, ok } from "./model";

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

export const mainSides: readonly Side[] = ["client", "shared", "server", "code"];
export const traySides: readonly Side[] = ["unreached", "test", "tooling"];

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

export const nodeStats = (modules: readonly ModuleNode[]) => {
  const scores = modules.flatMap((module) => (module.metrics.maxCC === null ? [] : [module.metrics.maxCC]));

  return {
    entries: modules.filter((module) => module.placement.entry !== null).length,
    maxCC: scores.length > 0 ? Math.max(...scores) : null,
    cyclic: modules.some((module) => module.metrics.cycleGroup !== null),
  };
};

export const externalCounts = (modules: readonly ModuleNode[]) =>
  [
    ...modules
      .flatMap((module) => module.externals)
      .reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map<string, number>()),
  ].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export const breadthFirst = (starts: readonly string[], next: (id: string) => readonly string[]) => {
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

export const outgoingImports = (data: GraphSnapshot) =>
  data.dependencyEdges.reduce(
    (map, edge) => map.set(edge.from, [...(map.get(edge.from) ?? []), edge.to]),
    new Map<string, string[]>(),
  );

export const routeReach = (
  data: GraphSnapshot,
  route: Route,
  outgoing: ReadonlyMap<string, readonly string[]> = outgoingImports(data),
): Record<"client" | "server", string[]> => {
  const reach = (side: "client" | "server") => [
    ...breadthFirst(
      route.files.filter((file) => file.side === side).map((file) => file.moduleId),
      (id) => outgoing.get(id) ?? [],
    ).keys(),
  ];

  return { client: reach("client"), server: reach("server") };
};

export const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const partNames = (tree: Tree): Map<string, string> => {
  const names = new Map<string, string>();
  const visit = (node: TreeNode, name: string) => {
    names.set(node.id, name);
    const used = new Map<string, number>();

    node.children.forEach((id) => {
      const child = tree.nodes.get(id);

      if (!child) return;

      const base = child.kind === "side" && child.side !== null ? child.side : slug(child.label) || "part";
      const count = (used.get(base) ?? 0) + 1;
      const own = count === 1 ? base : `${base}-${count}`;
      used.set(base, count);
      visit(child, name === "" ? own : `${name}/${own}`);
    });
  };

  visit(tree.root, "");
  return names;
};

export const findPart = (tree: Tree, names: ReadonlyMap<string, string>, name: string): Result<TreeNode> => {
  const wanted = name.replace(/^\/+|\/+$/g, "");
  const idOf = (partName: string) => [...names].find(([, candidate]) => candidate === partName)?.[0];
  const found = tree.nodes.get(idOf(wanted) ?? "");

  if (found) return ok(found);

  const segments = wanted.split("/");
  const closest =
    segments
      .map((_, index) => segments.slice(0, segments.length - 1 - index).join("/"))
      .find((prefix) => idOf(prefix) !== undefined) ?? "";
  const options = (tree.nodes.get(idOf(closest) ?? "root")?.children ?? []).flatMap((id) => names.get(id) ?? []);

  return err(
    `No part "${wanted}". ${closest === "" ? "Top level" : `Inside ${closest}`}: ${options.join(", ") || "none"}.`,
  );
};
