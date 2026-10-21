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
  Side,
} from "../src/model";
import { groupBy } from "./dom";

export type Index = {
  modules: Map<string, ModuleNode>;
  functions: Map<string, FunctionNode>;
  lanes: Map<Side, Lane>;
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
    [...groupBy(data.modules, (module) => module.metrics.cycleGroup)].flatMap(([group, modules]) =>
      group === null ? [] : [[group, modules] as const],
    ),
  ),
});

export const lineRef = (location: Location) => `${location.file}:${location.line}`;
export const fullRef = (location: Location) => `${location.file}:${location.line}:${location.column + 1}`;

export const routeLabel = (route: Route, multipleApps: boolean) => {
  const groups = route.directory
    .split("/")
    .filter((segment) => /^\(.*\)$/.test(segment))
    .join(" ");

  return `${multipleApps ? `${route.app || "."} ` : ""}${route.url}${groups ? ` ${groups}` : ""}`;
};
