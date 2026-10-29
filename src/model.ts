export type Location = { file: string; line: number; column: number };

export type ModuleMetrics = {
  fanIn: number;
  fanOut: number;
  visibilityFanIn: number;
  visibilityFanOut: number;
  maxCC: number | null;
  decisions: number;
  excessCC: number;
  functionCount: number;
  cycleGroup: number | null;
};

export type Side = "client" | "shared" | "server" | "code" | "unreached" | "tooling";

export type Grouping = "areas" | "folders";

export type SideInfo = { side: Side; label: string; description: string; grouping: Grouping };

export const sideInfo = (kit: boolean): readonly SideInfo[] => [
  {
    side: "client",
    label: "UI / client bundle",
    description:
      "Reached only from components, universal loads and client hooks. SvelteKit ships this code to the browser (it also runs during server-side rendering).",
    grouping: "areas",
  },
  {
    side: "shared",
    label: "Shared",
    description: "Reached from both the client bundle and server-only entry points.",
    grouping: "areas",
  },
  {
    side: "server",
    label: "Server only",
    description:
      "Reached only from server entry points (+page.server, +layout.server, +server, hooks.server) or marked server-only by SvelteKit ($lib/server, *.server.*). Never sent to the browser.",
    grouping: "areas",
  },
  {
    side: "code",
    label: "Code",
    description: kit
      ? "Source files outside a SvelteKit app and not reached from one."
      : "Source files of the project.",
    grouping: "areas",
  },
  {
    side: "unreached",
    label: "Not reached",
    description:
      "Inside a SvelteKit app, but no entry point imports it at runtime. It may be unused, used only by tests or for types, or loaded in a way static imports do not show.",
    grouping: "folders",
  },
  {
    side: "tooling",
    label: "Tooling & config",
    description: kit
      ? "Config files and SvelteKit app files outside src/ (scripts, build and test setup)."
      : "Config files (build and test setup).",
    grouping: "folders",
  },
];

export type Placement = {
  side: Side;
  entry: string | null;
  chains: { client?: string[]; server?: string[] };
};

export type ModuleNode = {
  id: string;
  path: string;
  metrics: ModuleMetrics;
  placement: Placement;
  groupId: string;
  areaId: string | null;
  subAreaId: string | null;
  externals: string[];
  barrel: boolean;
};

export type Area = {
  id: string;
  side: Side;
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

export type ModuleGroup = { id: string; side: Side; directory: string; moduleIds: string[] };

export type DecisionKind = "if" | "loop" | "case" | "catch" | "return" | "throw" | "statement";

export type Decision = { line: number; kind: DecisionKind; weight: number; label: string };

export type FunctionNode = {
  id: string;
  moduleId: string;
  name: string;
  location: Location;
  complexity: number;
  branches: number;
  inclusive: number;
  outerWrites: number;
  decisions: Decision[];
  waysOut: number;
};

export type ClassNode = {
  id: string;
  moduleId: string;
  name: string;
  location: Location;
  inclusive: number;
};

export type DependencyEdge = {
  kind: "imports";
  from: string;
  to: string;
  occurrences: Location[];
  names: string[];
  via: string[];
  typeOnly: boolean;
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
  | "server-only-import"
  | "self-import";

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
  sides: SideInfo[];
  groups: ModuleGroup[];
  areas: Area[];
  routes: Route[];
  modules: ModuleNode[];
  functions: FunctionNode[];
  classes: ClassNode[];
  dependencyEdges: DependencyEdge[];
  callEdges: CallEdge[];
  diagnostics: Diagnostic[];
};

export type Result<T, E = string> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export const byText = (a: string, b: string) => a.localeCompare(b);

export const directoryOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
};

export const functionId = (location: Location) => `fn:${location.file}:${location.line}:${location.column}`;
export const classId = (location: Location) => `class:${location.file}:${location.line}:${location.column}`;
export const isStandaloneArea = (id: string) => id.endsWith(":standalone");
export const isWidelyUsedArea = (id: string) => id.endsWith(":widely-used");
