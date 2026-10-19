import type {
  Area,
  CallEdge,
  DependencyEdge,
  Diagnostic,
  FunctionNode,
  GraphSnapshot,
  Lane,
  Location,
  ModuleNode,
  Route,
} from "../src/model";
import { groupBy } from "./dom";

export type Index = {
  modules: Map<string, ModuleNode>;
  functions: Map<string, FunctionNode>;
  lanes: Map<string, Lane>;
  areas: Map<string, Area>;
  routes: Map<string, Route>;
  importsFrom: Map<string, DependencyEdge[]>;
  importsTo: Map<string, DependencyEdge[]>;
  callsFrom: Map<string, CallEdge[]>;
  callsTo: Map<string, CallEdge[]>;
  diagnosticsByFile: Map<string, Diagnostic[]>;
  cycles: Map<number, ModuleNode[]>;
};

export const buildIndex = (data: GraphSnapshot): Index => ({
  modules: new Map(data.modules.map((module) => [module.id, module])),
  functions: new Map(data.functions.map((fn) => [fn.id, fn])),
  lanes: new Map(data.lanes.map((lane) => [lane.side, lane])),
  areas: new Map(data.areas.map((area) => [area.id, area])),
  routes: new Map(data.routes.map((route) => [route.id, route])),
  importsFrom: groupBy(data.dependencyEdges, (edge) => edge.from),
  importsTo: groupBy(data.dependencyEdges, (edge) => edge.to),
  callsFrom: groupBy(data.callEdges, (edge) => edge.from),
  callsTo: groupBy(data.callEdges, (edge) => edge.to),
  diagnosticsByFile: groupBy(data.diagnostics, (diagnostic) => diagnostic.file),
  cycles: new Map(
    [
      ...groupBy(
        data.modules.filter((module) => module.metrics.cycleGroup !== null),
        (module) => String(module.metrics.cycleGroup),
      ),
    ].map(([group, modules]) => [Number(group), modules]),
  ),
});

export const lineRef = (location: Location) => `${location.file}:${location.line}`;
export const fullRef = (location: Location) => `${location.file}:${location.line}:${location.column + 1}`;
export const moduleIdOf = (path: string) => `module:${path}`;
export const splitEdgeId = (id: string, prefix: string) => id.slice(prefix.length).split("->") as [string, string];

export const externalCounts = (modules: readonly ModuleNode[]) =>
  [
    ...modules
      .flatMap((module) => module.externals)
      .reduce((map, name) => map.set(name, (map.get(name) ?? 0) + 1), new Map<string, number>()),
  ].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

export const routeLabel = (route: Route, multipleApps: boolean) => {
  const groups = route.directory
    .split("/")
    .filter((segment) => /^\(.*\)$/.test(segment))
    .join(" ");
  return `${multipleApps ? `${route.app || "."} ` : ""}${route.url}${groups ? ` ${groups}` : ""}`;
};
