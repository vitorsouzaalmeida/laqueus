import type {
  Area,
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
import { type CcBand, type FanBand, type RankScale, ccBand, cycleSeverity, isHub, rankScale } from "./judgement";
import { smallestCuts, stronglyConnectedComponents } from "./metrics";
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

export type ImportRef = { path: string; lines: number[]; via: string[] };

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
  barrel: boolean;
  side: Side;
  entry: string | null;
  reason: string;
  chains: { client: string[] | null; server: string[] | null };
  area: string | null;
  subArea: string | null;
  fanIn: number;
  testFanIn: number;
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

export type CycleEdge = { from: string; to: string; lines: number[]; names: string[]; via: string[] };

export type CycleFacts = { number: number; files: string[]; edges: CycleEdge[]; cuts: CycleEdge[][] };

export type SideScales = { fanIn: RankScale; fanOut: RankScale };

export type AreaFacts = {
  id: string;
  label: string;
  cohesion: number | null;
  instability: number | null;
  incoming: number;
  outgoing: number;
  cycle: number | null;
};

export type AreaLink = { from: string; to: string; imports: number };

export type AreaCycle = { number: number; areas: string[] };

export type TwoWay = { a: string; b: string; ab: number; ba: number };

export type Violation = AreaLink & { fromInstability: number; toInstability: number };

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
  list
    .map((edge) => ({ path: modulePath(edge[end]), lines: lines(edge), via: edge.via.map(modulePath) }))
    .toSorted((a, b) => byText(a.path, b.path));

const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100) / 100);

const cycleEdge = (edge: DependencyEdge): CycleEdge => ({
  from: modulePath(edge.from),
  to: modulePath(edge.to),
  lines: lines(edge),
  names: edge.names,
  via: edge.via.map(modulePath),
});

const cutOrder = (a: readonly CycleEdge[], b: readonly CycleEdge[]) => {
  const weight = (cut: readonly CycleEdge[]) => cut.reduce((sum, edge) => sum + edge.names.length, 0);
  const key = (cut: readonly CycleEdge[]) => cut.map((edge) => `${edge.from}\u0000${edge.to}`).join("\u0001");
  return weight(a) - weight(b) || byText(key(a), key(b));
};

export const shownCuts = 5;

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

  const scales = new Map<Side, SideScales>(
    data.lanes.map(({ side }) => {
      const members = data.modules.filter((module) => module.placement.side === side);
      return [
        side,
        {
          fanIn: rankScale(members.map((member) => member.metrics.fanIn)),
          fanOut: rankScale(members.map((member) => member.metrics.fanOut)),
        },
      ] as const;
    }),
  );
  const scaleOf = (side: Side): SideScales => scales.get(side) ?? { fanIn: rankScale([]), fanOut: rankScale([]) };

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
    const scale = scaleOf(module.placement.side);
    const fanInRank = scale.fanIn.rank(module.metrics.fanIn);
    const fanOutRank = scale.fanOut.rank(module.metrics.fanOut);

    return {
      path: module.path,
      barrel: module.barrel,
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
      testFanIn: module.metrics.testFanIn,
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
        fanInBand: scale.fanIn.band(module.metrics.fanIn),
        fanInPercentile: fanInRank,
        fanOutBand: scale.fanOut.band(module.metrics.fanOut),
        fanOutPercentile: fanOutRank,
        maxCcBand: module.metrics.maxCC !== null ? ccBand(module.metrics.maxCC) : null,
        hub:
          !module.barrel &&
          isHub({ value: module.metrics.fanIn, rank: fanInRank }, { value: module.metrics.fanOut, rank: fanOutRank }),
        population: scale.fanIn.population,
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
    .map(([group, members]) => {
      const ids = new Set(members.map((module) => module.id));
      const inside = data.dependencyEdges
        .filter((edge) => ids.has(edge.from) && ids.has(edge.to))
        .toSorted((a, b) => byText(a.from, b.from) || byText(a.to, b.to));

      return {
        number: Number(group) + 1,
        files: members.map((module) => module.path).toSorted(byText),
        edges: inside.map(cycleEdge),
        cuts: smallestCuts([...ids], inside)
          .map((cut) => cut.map(cycleEdge))
          .toSorted(cutOrder),
      };
    })
    .toSorted((a, b) => a.number - b.number);

  const areaById = new Map(data.areas.map((area) => [area.id, area]));
  const areaLabelOf = (id: string) => areaById.get(id)?.label ?? id;
  const hasArea = (id: string) => (modules.get(id)?.areaId ?? null) !== null;
  const topOf = (id: string) => modules.get(id)?.areaId ?? null;
  const topAreas = data.areas.filter((area) => area.parent === null && area.id !== "area:standalone");
  const areaLinks: AreaLink[] = [
    ...edges
      .reduce((counts, edge) => {
        const from = topOf(edge.from);
        const to = topOf(edge.to);

        if (from === null || to === null || from === to) return counts;

        const key = `${from}\u0000${to}`;
        return counts.set(key, { from, to, imports: (counts.get(key)?.imports ?? 0) + 1 });
      }, new Map<string, AreaLink>())
      .values(),
  ].toSorted(
    (a, b) => byText(areaLabelOf(a.from), areaLabelOf(b.from)) || byText(areaLabelOf(a.to), areaLabelOf(b.to)),
  );
  const areaCycles: AreaCycle[] = stronglyConnectedComponents(
    topAreas.map((area) => area.id),
    new Map(
      [...groupBy(areaLinks, (link) => link.from)].map(([from, out]) => [from, out.map((link) => link.to)] as const),
    ),
  )
    .filter((component) => component.length > 1)
    .map((component) => component.toSorted((a, b) => byText(areaLabelOf(a), areaLabelOf(b))))
    .toSorted(([a = ""], [b = ""]) => byText(areaLabelOf(a), areaLabelOf(b)))
    .map((areaIds, index) => ({ number: index + 1, areas: areaIds }));
  const areaCycleOf = new Map(areaCycles.flatMap((cycle) => cycle.areas.map((id) => [id, cycle.number] as const)));

  const coupling = (area: Area): AreaFacts => {
    const members = new Set(area.moduleIds);
    const incoming = edges.filter((edge) => members.has(edge.to) && !members.has(edge.from) && hasArea(edge.from));
    const outgoing = edges.filter((edge) => members.has(edge.from) && !members.has(edge.to) && hasArea(edge.to));

    return {
      id: area.id,
      label: area.label,
      cohesion: ratio(area.internalImports, area.touchingImports),
      instability: ratio(outgoing.length, incoming.length + outgoing.length),
      incoming: incoming.length,
      outgoing: outgoing.length,
      cycle: areaCycleOf.get(area.id) ?? null,
    };
  };
  const areaFacts = new Map(data.areas.map((area) => [area.id, coupling(area)]));
  const linkCount = new Map(areaLinks.map((link) => [`${link.from}\u0000${link.to}`, link.imports]));
  const twoWay: TwoWay[] = areaLinks
    .filter((link) => byText(areaLabelOf(link.from), areaLabelOf(link.to)) < 0)
    .flatMap((link) => {
      const back = linkCount.get(`${link.to}\u0000${link.from}`);
      return back === undefined ? [] : [{ a: link.from, b: link.to, ab: link.imports, ba: back }];
    })
    .toSorted(
      (x, y) =>
        Math.min(y.ab, y.ba) - Math.min(x.ab, x.ba) ||
        y.ab + y.ba - (x.ab + x.ba) ||
        byText(areaLabelOf(x.a), areaLabelOf(y.a)) ||
        byText(areaLabelOf(x.b), areaLabelOf(y.b)),
    );
  const violations: Violation[] = areaLinks
    .flatMap((link) => {
      const fromInstability = areaFacts.get(link.from)?.instability ?? null;
      const toInstability = areaFacts.get(link.to)?.instability ?? null;

      return fromInstability !== null && toInstability !== null && fromInstability < toInstability
        ? [{ ...link, fromInstability, toInstability }]
        : [];
    })
    .toSorted(
      (a, b) =>
        b.imports - a.imports ||
        b.toInstability - b.fromInstability - (a.toInstability - a.fromInstability) ||
        byText(areaLabelOf(a.from), areaLabelOf(b.from)) ||
        byText(areaLabelOf(a.to), areaLabelOf(b.to)),
    );

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
    scaleOf,
    areaFacts,
    areaLinks,
    areaCycles,
    twoWay,
    violations,
    areaLabelOf,
    routes,
    diagnostics,
  };
};

export type Facts = ReturnType<typeof createFacts>;
