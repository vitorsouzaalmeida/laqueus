import type {
  CallEdge,
  DependencyEdge,
  DiagnosticKind,
  FunctionLogic,
  GraphSnapshot,
  LogicNodeKind,
  ModuleNode,
  RouteRole,
  Side,
} from "./model";
import { modulePath } from "./model";
import { type CcBand, type FanBand, ccBand, cycleSeverity, isHub, rankScale } from "./judgement";
import { externalCounts, nodeStats, outgoingImports, routeReach } from "./tree";

export type Stats = {
  files: number;
  entryPoints: number;
  functions: number;
  maxCC: number | null;
  filesInCycles: number;
  imports: { internal: number; incoming: number; outgoing: number };
};

export type PackageCount = { name: string; files: number };

export type ImportRef = { path: string; lines: number[] };

export type CallRef = { id: string; name: string; file: string; lines: number[] };

export type FileBands = {
  fanInBand: FanBand;
  fanInPercentile: number;
  fanOutBand: FanBand;
  fanOutPercentile: number;
  maxCcBand: CcBand | null;
  hub: boolean;
  population: number;
};

export type FileFacts = {
  path: string;
  side: Side;
  entry: string | null;
  reason: string;
  chains: { client: string[] | null; server: string[] | null };
  area: string | null;
  subArea: string | null;
  fanIn: number;
  fanOut: number;
  functionCount: number;
  maxCC: number | null;
  meanCC: number | null;
  cycle: number | null;
  island: number;
  imports: ImportRef[];
  importedBy: ImportRef[];
  packages: string[];
  bands: FileBands;
};

export type Decision = { line: number; kind: LogicNodeKind; weight: number; label: string };

export type FunctionFacts = {
  id: string;
  file: string;
  name: string;
  line: number;
  column: number;
  cc: number;
  ccBand: CcBand;
  calls: CallRef[];
  calledBy: CallRef[];
  logic: { decisions: Decision[]; waysOut: number } | null;
};

export type CycleFacts = { number: number; files: string[] };

export type RouteFacts = {
  id: string;
  url: string;
  app: string;
  directory: string;
  files: { role: RouteRole; side: "client" | "server"; path: string }[];
  layouts: string[];
  reach: { client: string[]; server: string[] };
  packages: { client: PackageCount[]; server: PackageCount[] };
};

export type Crossing = { key: string; outgoing: number; incoming: number };

export type Link = { from: string; to: string; imports: number };

export type DiagnosticFacts = { file: string; line: number | null; kind: DiagnosticKind; message: string };

export const byText = (a: string, b: string) => a.localeCompare(b);

const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> =>
  items.reduce((map, item) => {
    const group = map.get(key(item));

    if (group) group.push(item);
    else map.set(key(item), [item]);

    return map;
  }, new Map<string, T[]>());

const lines = (edge: DependencyEdge | CallEdge) => [
  ...new Set(edge.occurrences.map((location) => location.line).toSorted((a, b) => a - b)),
];

const importRefs = (list: readonly DependencyEdge[], end: "from" | "to"): ImportRef[] =>
  list.map((edge) => ({ path: modulePath(edge[end]), lines: lines(edge) })).toSorted((a, b) => byText(a.path, b.path));

export const branchStep = (trail: readonly string[], steps: readonly string[]): string | undefined => {
  const index = steps.findIndex((step, position) => trail[position] !== step);
  return index < 0 ? undefined : steps.at(index);
};

export const createFacts = (data: GraphSnapshot, logic: ReadonlyMap<string, FunctionLogic> | null) => {
  const modules = new Map(data.modules.map((module) => [module.id, module]));
  const functionsById = new Map(data.functions.map((fn) => [fn.id, fn]));
  const areas = new Map(data.areas.map((area) => [area.id, area]));
  const edges = data.dependencyEdges.filter((edge) => edge.from !== edge.to);
  const importsFrom = groupBy(edges, (edge) => edge.from);
  const importsTo = groupBy(edges, (edge) => edge.to);

  const fanInScale = rankScale(data.modules.map((m) => m.metrics.fanIn));
  const fanOutScale = rankScale(data.modules.map((m) => m.metrics.fanOut));

  const cycleEdgeCounts = new Map<number, number>();
  edges.forEach((edge) => {
    const fromGroup = modules.get(edge.from)?.metrics.cycleGroup;
    const toGroup = modules.get(edge.to)?.metrics.cycleGroup;
    if (fromGroup !== null && fromGroup !== undefined && fromGroup === toGroup)
      cycleEdgeCounts.set(fromGroup, (cycleEdgeCounts.get(fromGroup) ?? 0) + 1);
  });
  const callsFrom = groupBy(data.callEdges, (edge) => edge.from);
  const callsTo = groupBy(data.callEdges, (edge) => edge.to);
  const functionsByModule = groupBy(data.functions, (fn) => fn.moduleId);
  const membersOf = (moduleIds: readonly string[]) => moduleIds.flatMap((id) => modules.get(id) ?? []);

  const stats = (moduleIds: readonly string[]): Stats => {
    const members = membersOf(moduleIds);
    const inside = new Set(moduleIds);
    const summary = nodeStats(members);
    const outward = moduleIds.flatMap((id) => importsFrom.get(id) ?? []);
    const inward = moduleIds.flatMap((id) => importsTo.get(id) ?? []);

    return {
      files: members.length,
      entryPoints: summary.entries,
      functions: members.reduce((sum, module) => sum + module.metrics.functionCount, 0),
      maxCC: summary.maxCC,
      filesInCycles: members.filter((module) => module.metrics.cycleGroup !== null).length,
      imports: {
        internal: outward.filter((edge) => inside.has(edge.to)).length,
        incoming: inward.filter((edge) => !inside.has(edge.from)).length,
        outgoing: outward.filter((edge) => !inside.has(edge.to)).length,
      },
    };
  };

  const areaLabel = (id: string | null) => (id === null ? null : (areas.get(id)?.label ?? null));

  const file = (module: ModuleNode): FileFacts => {
    const fanInRank = fanInScale.rank(module.metrics.fanIn);
    const fanOutRank = fanOutScale.rank(module.metrics.fanOut);

    return {
      path: module.path,
      side: module.placement.side,
      entry: module.placement.entry,
      reason: module.placement.reason,
      chains: {
        client: module.placement.chains.client?.map(modulePath) ?? null,
        server: module.placement.chains.server?.map(modulePath) ?? null,
      },
      area: areaLabel(module.areaId),
      subArea: areaLabel(module.subAreaId),
      fanIn: module.metrics.fanIn,
      fanOut: module.metrics.fanOut,
      functionCount: module.metrics.functionCount,
      maxCC: module.metrics.maxCC,
      meanCC: module.metrics.meanCC,
      cycle: module.metrics.cycleGroup === null ? null : module.metrics.cycleGroup + 1,
      island: module.metrics.island,
      imports: importRefs(importsFrom.get(module.id) ?? [], "to"),
      importedBy: importRefs(importsTo.get(module.id) ?? [], "from"),
      packages: module.externals,
      bands: {
        fanInBand: fanInScale.band(module.metrics.fanIn),
        fanInPercentile: fanInRank,
        fanOutBand: fanOutScale.band(module.metrics.fanOut),
        fanOutPercentile: fanOutRank,
        maxCcBand: module.metrics.maxCC !== null ? ccBand(module.metrics.maxCC) : null,
        hub: isHub(fanInRank, fanOutRank),
        population: fanInScale.population,
      },
    };
  };

  const callRefs = (list: readonly CallEdge[], end: "from" | "to"): CallRef[] =>
    list
      .flatMap((edge) => {
        const fn = functionsById.get(edge[end]);
        return fn ? [{ id: fn.id, name: fn.name, file: fn.location.file, lines: lines(edge) }] : [];
      })
      .toSorted((a, b) => byText(a.file, b.file) || byText(a.id, b.id));

  const logicOf = (id: string): FunctionFacts["logic"] => {
    const found = logic?.get(id);

    return found
      ? {
          decisions: found.nodes
            .filter((node) => node.weight > 0)
            .toSorted((a, b) => a.lines.start - b.lines.start)
            .map((node) => ({
              line: node.lines.start,
              kind: node.kind,
              weight: node.weight,
              label: node.label.split("\n")[0] ?? node.label,
            })),
          waysOut: found.nodes.filter((node) => ["return", "throw", "end"].includes(node.kind)).length,
        }
      : null;
  };

  const functionsOf = (moduleId: string): FunctionFacts[] =>
    (functionsByModule.get(moduleId) ?? [])
      .toSorted((a, b) => a.location.line - b.location.line || a.location.column - b.location.column)
      .map((fn) => ({
        id: fn.id,
        file: fn.location.file,
        name: fn.name,
        line: fn.location.line,
        column: fn.location.column + 1,
        cc: fn.complexity,
        ccBand: ccBand(fn.complexity),
        calls: callRefs(callsFrom.get(fn.id) ?? [], "to"),
        calledBy: callRefs(callsTo.get(fn.id) ?? [], "from"),
        logic: logicOf(fn.id),
      }));

  const packages = (moduleIds: readonly string[]): PackageCount[] =>
    externalCounts(membersOf(moduleIds))
      .map(([name, count]) => ({ name, files: count }))
      .toSorted((a, b) => byText(a.name, b.name));

  const crossings = (moduleIds: readonly string[], branchOf: (moduleId: string) => string | undefined): Crossing[] => {
    const inside = new Set(moduleIds);
    const counts = new Map<string, Crossing>();
    const count = (outsideId: string, direction: "outgoing" | "incoming") => {
      const key = branchOf(outsideId);

      if (key === undefined) return;

      const entry = counts.get(key) ?? { key, outgoing: 0, incoming: 0 };
      counts.set(key, { ...entry, [direction]: entry[direction] + 1 });
    };

    moduleIds.forEach((id) => {
      (importsFrom.get(id) ?? []).filter((edge) => !inside.has(edge.to)).forEach((edge) => count(edge.to, "outgoing"));
      (importsTo.get(id) ?? [])
        .filter((edge) => !inside.has(edge.from))
        .forEach((edge) => count(edge.from, "incoming"));
    });

    return [...counts.values()].toSorted((a, b) => byText(a.key, b.key));
  };

  const links = (childOf: ReadonlyMap<string, string>): Link[] => {
    const counts = new Map<string, Link>();

    [...childOf].forEach(([id, from]) =>
      (importsFrom.get(id) ?? []).forEach((edge) => {
        const to = childOf.get(edge.to);

        if (to === undefined || to === from) return;

        const key = `${from}\u0000${to}`;
        counts.set(key, { from, to, imports: (counts.get(key)?.imports ?? 0) + 1 });
      }),
    );

    return [...counts.values()].toSorted((a, b) => byText(a.from, b.from) || byText(a.to, b.to));
  };

  const cycles: CycleFacts[] = [...groupBy(data.modules, (module) => String(module.metrics.cycleGroup ?? ""))]
    .filter(([group]) => group !== "")
    .map(([group, members]) => ({
      number: Number(group) + 1,
      files: members.map((module) => module.path).toSorted(byText),
    }))
    .toSorted((a, b) => a.number - b.number);

  const outgoing = outgoingImports(data);
  const routes: RouteFacts[] = data.routes.map((route) => {
    const reach = routeReach(data, route, outgoing);

    return {
      id: route.id,
      url: route.url,
      app: route.app,
      directory: route.directory,
      files: route.files.map((entry) => ({ role: entry.role, side: entry.side, path: modulePath(entry.moduleId) })),
      layouts: route.layouts.map(modulePath),
      reach: {
        client: reach.client.map(modulePath).toSorted(byText),
        server: reach.server.map(modulePath).toSorted(byText),
      },
      packages: { client: packages(reach.client), server: packages(reach.server) },
    };
  });

  const diagnostics: DiagnosticFacts[] = data.diagnostics
    .map((diagnostic) => ({
      file: diagnostic.file,
      line: diagnostic.line ?? null,
      kind: diagnostic.kind,
      message: diagnostic.message,
    }))
    .toSorted((a, b) => byText(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0));

  const cycleBands = new Map(
    cycles.map((cycle) => [
      cycle.number,
      cycleSeverity(cycle.files.length, cycleEdgeCounts.get(cycle.number - 1) ?? 0),
    ]),
  );

  return {
    data,
    modules,
    stats,
    file,
    functionsOf,
    packages,
    crossings,
    links,
    cycles,
    cycleBands,
    fanInScale,
    fanOutScale,
    routes,
    diagnostics,
  };
};

export type Facts = ReturnType<typeof createFacts>;
