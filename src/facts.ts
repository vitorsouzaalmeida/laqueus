import { modularity } from "./areas";
import {
  type CcBand,
  type CycleSeverity,
  type FanBand,
  type RankScale,
  type Role,
  ccBand,
  cycleSeverity,
  highFrom,
  median,
  rankScale,
  role,
} from "./judgement";
import { fewestBackLinks } from "./layers";
import { cycleGroups, smallestCuts, visibility } from "./metrics";
import type {
  CallEdge,
  DependencyEdge,
  DiagnosticKind,
  FunctionLogic,
  FunctionNode,
  GraphSnapshot,
  LogicNodeKind,
  ModuleNode,
  RouteRole,
  Side,
} from "./model";
import { isStandaloneArea, modulePath } from "./model";
import { externalCounts, nodeStats, outgoingImports, routeReach } from "./tree";

export type Stats = {
  files: number;
  entryPoints: number;
  functions: number;
  maxCC: number | null;
  decisions: number;
  excessCC: number;
  filesInCycles: number;
  imports: { internal: number; incoming: number; outgoing: number };
};

export type PackageCount = { name: string; files: number };

export type ImportRef = { path: string; lines: number[]; via: string[]; typeOnly: boolean };

export type CallRef = { id: string; name: string; file: string; lines: number[] };

export type Rank = { band: FanBand; percentile: number; population: number } | null;

export type FileFacts = {
  path: string;
  barrel: boolean;
  side: Side;
  entry: string | null;
  chains: { client: string[] | null; server: string[] | null };
  area: string | null;
  subArea: string | null;
  fanIn: number;
  fanOut: number;
  fanInRank: Rank;
  fanOutRank: Rank;
  visibility: { fanIn: number; fanOut: number; role: Role };
  functionCount: number;
  maxCC: number | null;
  maxCcBand: CcBand | null;
  decisions: number;
  excessCC: number;
  cycle: number | null;
  imports: ImportRef[];
  importedBy: ImportRef[];
  packages: string[];
};

export type Decision = { line: number; kind: LogicNodeKind; weight: number; label: string };

export type FunctionFacts = {
  id: string;
  file: string;
  name: string;
  line: number;
  column: number;
  cc: number;
  branches: number;
  inclusive: number;
  outerWrites: number;
  ccBand: CcBand;
  calls: CallRef[];
  calledBy: CallRef[];
  logic: { decisions: Decision[]; waysOut: number } | null;
};

export type ClassFacts = { id: string; file: string; name: string; line: number; inclusive: number };

export type CycleEdge = {
  from: string;
  to: string;
  lines: number[];
  names: string[];
  via: string[];
  typeOnly: boolean;
};

export type CutSearch = "all" | "exact" | "approximate";

export type CycleFacts = {
  number: number;
  files: string[];
  edges: CycleEdge[];
  cuts: CycleEdge[][];
  search: CutSearch;
  severity: CycleSeverity;
  withoutTypes: number;
  reach: { fanIn: number; fanOut: number; pairs: number };
};

export type SideScales = {
  fanIn: RankScale;
  fanOut: RankScale;
  medians: { fanIn: number; fanOut: number };
  files: number;
};

export type AreaFacts = {
  id: string;
  side: Side;
  label: string;
  parent: string | null;
  files: number;
  internal: number;
  touching: number;
  cohesion: number | null;
  instability: number | null;
  incoming: number;
  outgoing: number;
};

export type AreaLink = { side: Side; from: string; to: string; imports: number; names: number };

export type TwoWay = { side: Side; a: string; b: string; ab: number; ba: number };

export type Layers = {
  side: Side;
  order: string[];
  back: CycleEdge[];
  between: number;
  approximate: boolean;
};

export type BandShares = { total: number; low: number; moderate: number; high: number };

export type Complexity = { side: Side; functions: number; conditions: BandShares; branches: BandShares };

export type Health = {
  side: Side;
  files: number;
  propagationCost: number | null;
  largestCycle: number;
  layers: Layers | null;
  complexity: Complexity;
  modularity: { areas: number | null; folders: number | null };
};

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
    .map((edge) => ({
      path: modulePath(edge[end]),
      lines: lines(edge),
      via: edge.via.map(modulePath),
      typeOnly: edge.typeOnly,
    }))
    .toSorted((a, b) => byText(a.path, b.path));

const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100) / 100);

const cycleEdge = (edge: DependencyEdge): CycleEdge => ({
  from: modulePath(edge.from),
  to: modulePath(edge.to),
  lines: lines(edge),
  names: edge.names,
  via: edge.via.map(modulePath),
  typeOnly: edge.typeOnly,
});

const edgeKey = (edge: { from: string; to: string }) => `${edge.from}\u0000${edge.to}`;

const cutOrder = (a: readonly CycleEdge[], b: readonly CycleEdge[]) => {
  const weight = (cut: readonly CycleEdge[]) => cut.reduce((sum, edge) => sum + edge.names.length, 0);
  const key = (cut: readonly CycleEdge[]) => cut.map(edgeKey).join("\u0001");
  return weight(a) - weight(b) || byText(key(a), key(b));
};

export const shownCuts = 5;

export const branchStep = (trail: readonly string[], steps: readonly string[]): string | undefined => {
  const index = steps.findIndex((step, position) => trail[position] !== step);
  return index < 0 ? undefined : steps.at(index);
};

export const bandShares = (scores: readonly number[]): BandShares =>
  scores.reduce(
    (shares, score) => ({
      ...shares,
      total: shares.total + score - 1,
      [ccBand(score)]: shares[ccBand(score)] + score - 1,
    }),
    { total: 0, low: 0, moderate: 0, high: 0 },
  );

export const areaSides: readonly Side[] = ["client", "shared", "server", "code"];

export const holdsInside = (fn: FunctionFacts) => fn.inclusive >= highFrom && fn.cc < highFrom;

const rankOf = (scale: RankScale, value: number, ranked: boolean): Rank =>
  ranked ? { band: scale.band(value), percentile: scale.rank(value), population: scale.population } : null;

const directoryOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ".");

export const createFacts = (data: GraphSnapshot, logic: ReadonlyMap<string, FunctionLogic> | null) => {
  const modules = new Map(data.modules.map((module) => [module.id, module]));
  const functionsById = new Map(data.functions.map((fn) => [fn.id, fn]));
  const areas = new Map(data.areas.map((area) => [area.id, area]));
  const edges = data.dependencyEdges.filter((edge) => edge.from !== edge.to);
  const importsFrom = groupBy(edges, (edge) => edge.from);
  const importsTo = groupBy(edges, (edge) => edge.to);
  const sideOf = (id: string) => modules.get(id)?.placement.side;
  const sides = data.lanes.map((lane) => lane.side);

  const scales = new Map<Side, SideScales>(
    sides.map((side) => {
      const members = data.modules.filter((module) => module.placement.side === side);
      const ranked = members.filter((member) => !member.barrel);
      return [
        side,
        {
          fanIn: rankScale(
            ranked.filter((member) => member.placement.entry === null).map((member) => member.metrics.fanIn),
          ),
          fanOut: rankScale(ranked.map((member) => member.metrics.fanOut)),
          medians: {
            fanIn: median(members.map((member) => member.metrics.visibilityFanIn)),
            fanOut: median(members.map((member) => member.metrics.visibilityFanOut)),
          },
          files: members.length,
        },
      ] as const;
    }),
  );
  const scaleOf = (side: Side): SideScales =>
    scales.get(side) ?? { fanIn: rankScale([]), fanOut: rankScale([]), medians: { fanIn: 0, fanOut: 0 }, files: 0 };

  const callsFrom = groupBy(data.callEdges, (edge) => edge.from);
  const callsTo = groupBy(data.callEdges, (edge) => edge.to);
  const functionsByModule = groupBy(data.functions, (fn) => fn.moduleId);
  const classesByModule = groupBy(data.classes, (cls) => cls.moduleId);
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
      decisions: members.reduce((sum, module) => sum + module.metrics.decisions, 0),
      excessCC: members.reduce((sum, module) => sum + module.metrics.excessCC, 0),
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
    const { metrics } = module;

    return {
      path: module.path,
      barrel: module.barrel,
      side: module.placement.side,
      entry: module.placement.entry,
      chains: {
        client: module.placement.chains.client?.map(modulePath) ?? null,
        server: module.placement.chains.server?.map(modulePath) ?? null,
      },
      area: areaLabel(module.areaId),
      subArea: areaLabel(module.subAreaId),
      fanIn: metrics.fanIn,
      fanOut: metrics.fanOut,
      fanInRank: rankOf(scale.fanIn, metrics.fanIn, !module.barrel && module.placement.entry === null),
      fanOutRank: rankOf(scale.fanOut, metrics.fanOut, !module.barrel),
      visibility: {
        fanIn: metrics.visibilityFanIn,
        fanOut: metrics.visibilityFanOut,
        role: role(metrics.visibilityFanIn, metrics.visibilityFanOut, scale.medians),
      },
      functionCount: metrics.functionCount,
      maxCC: metrics.maxCC,
      maxCcBand: metrics.maxCC === null ? null : ccBand(metrics.maxCC),
      decisions: metrics.decisions,
      excessCC: metrics.excessCC,
      cycle: metrics.cycleGroup === null ? null : metrics.cycleGroup + 1,
      imports: importRefs(importsFrom.get(module.id) ?? [], "to"),
      importedBy: importRefs(importsTo.get(module.id) ?? [], "from"),
      packages: module.externals,
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

  const functionFacts = (fn: FunctionNode): FunctionFacts => ({
    id: fn.id,
    file: fn.location.file,
    name: fn.name,
    line: fn.location.line,
    column: fn.location.column + 1,
    cc: fn.complexity,
    branches: fn.branches,
    inclusive: fn.inclusive,
    outerWrites: fn.outerWrites,
    ccBand: ccBand(fn.complexity),
    calls: callRefs(callsFrom.get(fn.id) ?? [], "to"),
    calledBy: callRefs(callsTo.get(fn.id) ?? [], "from"),
    logic: logicOf(fn.id),
  });

  const functionsOf = (moduleId: string): FunctionFacts[] =>
    (functionsByModule.get(moduleId) ?? [])
      .toSorted((a, b) => a.location.line - b.location.line || a.location.column - b.location.column)
      .map(functionFacts);

  const classesOf = (moduleId: string): ClassFacts[] =>
    (classesByModule.get(moduleId) ?? [])
      .toSorted((a, b) => a.location.line - b.location.line || a.location.column - b.location.column)
      .map((cls) => ({
        id: cls.id,
        file: cls.location.file,
        name: cls.name,
        line: cls.location.line,
        inclusive: cls.inclusive,
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
      const ids = members.map((module) => module.id).toSorted(byText);
      const inside = new Set(ids);
      const within = edges
        .filter((edge) => inside.has(edge.from) && inside.has(edge.to))
        .toSorted((a, b) => byText(a.from, b.from) || byText(a.to, b.to));
      const listed = smallestCuts(ids, within)
        .map((cut) => cut.map(cycleEdge))
        .toSorted(cutOrder);
      const searched =
        listed.length > 0
          ? null
          : fewestBackLinks(
              ids,
              within.map((edge) => ({ from: edge.from, to: edge.to, imports: 1, names: edge.names.length })),
            );
      const backKeys = new Set((searched?.back ?? []).map(edgeKey));
      const sample = members[0]?.metrics;
      const fanIn = sample?.visibilityFanIn ?? 0;
      const fanOut = sample?.visibilityFanOut ?? 0;

      return {
        number: Number(group) + 1,
        files: members.map((module) => module.path).toSorted(byText),
        edges: within.map(cycleEdge),
        cuts: searched ? [within.filter((edge) => backKeys.has(edgeKey(edge))).map(cycleEdge)] : listed,
        search: searched ? (searched.approximate ? "approximate" : "exact") : "all",
        severity: cycleSeverity(members.length, within.length),
        withoutTypes: cycleGroups(
          ids,
          within.filter((edge) => !edge.typeOnly),
        ).size,
        reach: { fanIn, fanOut, pairs: fanIn * fanOut },
      } satisfies CycleFacts;
    })
    .toSorted((a, b) => a.number - b.number);

  const areaById = new Map(data.areas.map((area) => [area.id, area]));
  const areaLabelOf = (id: string) => areaById.get(id)?.label ?? id;
  const topOf = (id: string) => modules.get(id)?.areaId ?? null;
  const sameSide = (edge: DependencyEdge) => sideOf(edge.from) === sideOf(edge.to);
  const betweenAreas = edges.filter((edge) => {
    const from = topOf(edge.from);
    const to = topOf(edge.to);
    return sameSide(edge) && from !== null && to !== null && from !== to;
  });
  const areaLinks: AreaLink[] = [
    ...betweenAreas
      .reduce((counts, edge) => {
        const from = topOf(edge.from) ?? "";
        const to = topOf(edge.to) ?? "";
        const key = `${from}\u0000${to}`;
        const known = counts.get(key);

        return counts.set(key, {
          side: sideOf(edge.from) ?? "code",
          from,
          to,
          imports: (known?.imports ?? 0) + 1,
          names: (known?.names ?? 0) + edge.names.length,
        });
      }, new Map<string, AreaLink>())
      .values(),
  ].toSorted(
    (a, b) => byText(areaLabelOf(a.from), areaLabelOf(b.from)) || byText(areaLabelOf(a.to), areaLabelOf(b.to)),
  );

  const coupling = (id: string): AreaFacts | null => {
    const area = areaById.get(id);

    if (!area) return null;

    const members = new Set(area.moduleIds);
    const sameSideArea = (other: string) => sideOf(other) === area.side && topOf(other) !== null;
    const incoming = edges.filter((edge) => members.has(edge.to) && !members.has(edge.from) && sameSideArea(edge.from));
    const outgoing = edges.filter((edge) => members.has(edge.from) && !members.has(edge.to) && sameSideArea(edge.to));

    return {
      id: area.id,
      side: area.side,
      label: area.label,
      parent: area.parent,
      files: area.moduleIds.length,
      internal: area.internalImports,
      touching: area.touchingImports,
      cohesion: ratio(area.internalImports, area.touchingImports),
      instability: ratio(outgoing.length, incoming.length + outgoing.length),
      incoming: incoming.length,
      outgoing: outgoing.length,
    };
  };
  const areaFacts = new Map(
    data.areas.flatMap((area) => {
      const found = coupling(area.id);
      return found ? [[area.id, found] as const] : [];
    }),
  );
  const linkCount = new Map(areaLinks.map((link) => [edgeKey(link), link.imports]));
  const twoWay: TwoWay[] = areaLinks
    .filter((link) => byText(areaLabelOf(link.from), areaLabelOf(link.to)) < 0)
    .flatMap((link) => {
      const back = linkCount.get(edgeKey({ from: link.to, to: link.from }));
      return back === undefined ? [] : [{ side: link.side, a: link.from, b: link.to, ab: link.imports, ba: back }];
    })
    .toSorted(
      (x, y) =>
        Math.min(y.ab, y.ba) - Math.min(x.ab, x.ba) ||
        y.ab + y.ba - (x.ab + x.ba) ||
        byText(areaLabelOf(x.a), areaLabelOf(y.a)) ||
        byText(areaLabelOf(x.b), areaLabelOf(y.b)),
    );

  const layers: Layers[] = areaSides.flatMap((side) => {
    const top = data.areas.filter((area) => area.side === side && area.parent === null && !isStandaloneArea(area.id));

    if (top.length < 2) return [];

    const sideLinks = areaLinks.filter((link) => link.side === side);
    const result = fewestBackLinks(
      top.map((area) => area.id),
      sideLinks,
    );
    const backKeys = new Set(result.back.map(edgeKey));
    const between = betweenAreas.filter((edge) => sideOf(edge.from) === side);

    return [
      {
        side,
        order: result.order,
        back: between
          .filter((edge) => backKeys.has(edgeKey({ from: topOf(edge.from) ?? "", to: topOf(edge.to) ?? "" })))
          .map(cycleEdge)
          .toSorted((a, b) => byText(a.from, b.from) || byText(a.to, b.to)),
        between: between.length,
        approximate: result.approximate,
      },
    ];
  });

  const sideFunctions = (side: Side) =>
    data.modules
      .filter((module) => module.placement.side === side)
      .flatMap((module) => functionsByModule.get(module.id) ?? []);

  const complexity: Complexity[] = sides.map((side) => {
    const functions = sideFunctions(side);
    return {
      side,
      functions: functions.length,
      conditions: bandShares(functions.map((fn) => fn.complexity)),
      branches: bandShares(functions.map((fn) => fn.branches)),
    };
  });

  const health: Health[] = sides.map((side) => {
    const members = data.modules.filter((module) => module.placement.side === side);
    const inSide = new Set(members.map((module) => module.id));
    const sideEdges = edges.filter((edge) => inSide.has(edge.from) && inSide.has(edge.to));
    const sideReach = visibility(
      members.map((module) => module.id),
      sideEdges,
    );
    const largestCycle = cycles
      .map((cycle) => cycle.files.filter((path) => inSide.has(`module:${path}`)).length)
      .reduce((max, size) => Math.max(max, size), 0);
    const areaGroups = new Map(
      members.flatMap((module) => (module.areaId === null ? [] : [[module.id, module.areaId] as const])),
    );

    return {
      side,
      files: members.length,
      propagationCost:
        members.length === 0
          ? null
          : members.reduce((sum, module) => sum + (sideReach.get(module.id)?.fanOut ?? 1), 0) /
            (members.length * members.length),
      largestCycle,
      layers: layers.find((entry) => entry.side === side) ?? null,
      complexity: complexity.find((entry) => entry.side === side) ?? {
        side,
        functions: 0,
        conditions: bandShares([]),
        branches: bandShares([]),
      },
      modularity: {
        areas: areaSides.includes(side) ? modularity(areaGroups, sideEdges) : null,
        folders: modularity(new Map(members.map((module) => [module.id, directoryOf(module.path)])), sideEdges),
      },
    };
  });

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

  return {
    data,
    modules,
    stats,
    file,
    functionsOf,
    classesOf,
    functionFacts,
    packages,
    crossings,
    links,
    cycles,
    scaleOf,
    areaFacts,
    areaLinks,
    twoWay,
    layers,
    complexity,
    health,
    areaLabelOf,
    routes,
    diagnostics,
  };
};

export type Facts = ReturnType<typeof createFacts>;
