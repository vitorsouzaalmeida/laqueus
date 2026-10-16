export type Location = { file: string; line: number; column: number };

export type ModuleMetrics = {
  fanIn: number;
  fanOut: number;
  maxCC: number | null;
  meanCC: number | null;
  functionCount: number;
  cycleGroup: number | null;
  island: number;
};

export type Point = { x: number; y: number };

export type Side = "client" | "shared" | "server" | "code" | "unreached" | "test" | "tooling";

export type Placement = {
  side: Side;
  entry: string | null;
  reason: string;
  chains: { client?: string[]; server?: string[] };
};

export type ModuleNode = {
  id: string;
  path: string;
  functionIds: string[];
  metrics: ModuleMetrics;
  placement: Placement;
  groupId: string;
  areaId: string | null;
  subAreaId: string | null;
  depth: number;
  position: Point;
  externals: string[];
};

export type Area = {
  id: string;
  label: string;
  parent: string | null;
  moduleIds: string[];
  internalImports: number;
  touchingImports: number;
};

export type RouteRole =
  | "page"
  | "universal-load"
  | "server-load"
  | "endpoint"
  | "layout"
  | "layout-load"
  | "layout-server-load"
  | "error";

export type RouteFile = { role: RouteRole; side: "client" | "server"; moduleId: string };

export type Route = {
  id: string;
  app: string;
  url: string;
  directory: string;
  files: RouteFile[];
  layouts: string[];
};

export type Lane = { side: Side; label: string; description: string };

export type ModuleGroup = { id: string; side: Side; directory: string; moduleIds: string[] };

export type GroupEdge = { from: string; to: string; count: number };

export type FunctionNode = {
  id: string;
  moduleId: string;
  name: string;
  location: Location;
  complexity: number;
};

export type DependencyEdge = {
  kind: "imports";
  from: string;
  to: string;
  occurrences: Location[];
};

export type CallEdge = {
  kind: "calls";
  from: string;
  to: string;
  occurrences: Location[];
};

export type DiagnosticKind =
  | "parse-error"
  | "unresolved-import"
  | "unsupported-syntax"
  | "server-only-import";

export type Diagnostic = {
  file: string;
  line?: number;
  kind: DiagnosticKind;
  message: string;
};

export type GraphSnapshot = {
  root: string;
  name: string;
  scannedAt: string;
  durationMs: number;
  framework: "sveltekit" | null;
  lanes: Lane[];
  groups: ModuleGroup[];
  groupEdges: GroupEdge[];
  areas: Area[];
  routes: Route[];
  modules: ModuleNode[];
  functions: FunctionNode[];
  dependencyEdges: DependencyEdge[];
  callEdges: CallEdge[];
  diagnostics: Diagnostic[];
};

export type LogicNodeKind =
  | "start"
  | "block"
  | "decision"
  | "loop"
  | "switch"
  | "try"
  | "catch"
  | "finally"
  | "return"
  | "throw"
  | "end";

export type LogicEdgeKind = "normal" | "true" | "false" | "case" | "back" | "break" | "exception";

export type LogicNode = {
  id: string;
  kind: LogicNodeKind;
  label: string;
  lines: { start: number; end: number };
  weight: number;
  calls: string[];
  nested: string[];
  region: string | null;
  unreachable: boolean;
  awaits: boolean;
};

export type LogicEdge = { id: string; from: string; to: string; label: string; kind: LogicEdgeKind };

export type LogicOutlineItem = { text: string; nodeId: string | null; children: LogicOutlineItem[] };

export type FunctionLogic = {
  functionId: string;
  name: string;
  file: string;
  complexity: number;
  nodes: LogicNode[];
  edges: LogicEdge[];
  outline: LogicOutlineItem[];
  source: { firstLine: number; lines: string[] };
};

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const moduleId = (path: string) => `module:${path}`;
export const functionId = (location: Location) =>
  `fn:${location.file}:${location.line}:${location.column}`;
