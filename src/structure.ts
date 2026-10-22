import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  type DependencyEdge,
  type Diagnostic,
  type GroupEdge,
  type Lane,
  type ModuleGroup,
  type Placement,
  type Point,
  type Route,
  type RouteFile,
  type RouteRole,
  type Side,
  moduleId,
  modulePath,
} from "./model";

type EntryRule = { pattern: RegExp; side: "client" | "server"; label: string };

const routeFile = (name: string) => new RegExp(`^src/routes/(.*/)?\\+${name}$`);

const sveltekitEntries: readonly EntryRule[] = [
  { pattern: routeFile("page(@[^/]*)?\\.svelte"), side: "client", label: "SvelteKit page component" },
  { pattern: routeFile("layout(@[^/]*)?\\.svelte"), side: "client", label: "SvelteKit layout component" },
  { pattern: routeFile("error\\.svelte"), side: "client", label: "SvelteKit error page" },
  { pattern: routeFile("page\\.[jt]s"), side: "client", label: "SvelteKit universal page load" },
  { pattern: routeFile("layout\\.[jt]s"), side: "client", label: "SvelteKit universal layout load" },
  { pattern: routeFile("page\\.server\\.[jt]s"), side: "server", label: "SvelteKit server page load / actions" },
  { pattern: routeFile("layout\\.server\\.[jt]s"), side: "server", label: "SvelteKit server layout load" },
  { pattern: routeFile("server\\.[jt]s"), side: "server", label: "SvelteKit API endpoint" },
  { pattern: /^src\/hooks\.server(\.[jt]s|\/index\.[jt]s)$/, side: "server", label: "SvelteKit server hooks" },
  { pattern: /^src\/hooks\.client(\.[jt]s|\/index\.[jt]s)$/, side: "client", label: "SvelteKit client hooks" },
  { pattern: /^src\/hooks(\.[jt]s|\/index\.[jt]s)$/, side: "client", label: "SvelteKit universal hooks" },
  { pattern: /^src\/instrumentation\.server\.[jt]s$/, side: "server", label: "SvelteKit server instrumentation" },
  { pattern: /^src\/service-worker(\.[jt]s|\/index\.[jt]s)$/, side: "client", label: "SvelteKit service worker" },
  { pattern: /^src\/params\/[^/]+\.[jt]s$/, side: "client", label: "SvelteKit param matcher" },
];

const testPatterns = [
  /\.(test|spec)\.[cm]?[jt]sx?$/,
  /\.stories\.([cm]?[jt]sx?|svelte)$/,
  /(^|\/)(__tests__|__mocks__|__fixtures__|e2e|tests?)\//,
];
const configPattern = /(^|\/)[^/]+\.config\.[cm]?[jt]s$/;

const laneInfo: Readonly<Record<Side, { label: string; description: string }>> = {
  client: {
    label: "UI / client bundle",
    description:
      "Reached only from components, universal loads and client hooks. SvelteKit ships this code to the browser (it also runs during server-side rendering).",
  },
  shared: {
    label: "Shared",
    description: "Reached from both the client bundle and server-only entry points.",
  },
  server: {
    label: "Server only",
    description:
      "Reached only from server entry points (+page.server, +layout.server, +server, hooks.server) or marked server-only by SvelteKit ($lib/server, *.server.*). Never sent to the browser.",
  },
  code: {
    label: "Code",
    description: "Source files outside a SvelteKit app and not reached from one.",
  },
  unreached: {
    label: "Not reached",
    description:
      "Inside a SvelteKit app, but no entry point imports it at runtime. It may be unused, used only by tests or for types, or loaded in a way static imports do not show.",
  },
  tooling: {
    label: "Tooling & config",
    description: "Config files and SvelteKit app files outside src/ (scripts, build and test setup).",
  },
};

const laneOrder: readonly Side[] = ["client", "shared", "server", "code", "unreached", "tooling"];

const minimumGroupSize = 4;
const cell = { width: 160, height: 60 };
const groupPadding = { x: 24, top: 44, bottom: 24 };
const gaps = { group: 40, subColumn: 60, lane: 160 };
const maximumColumns = 6;
const targetAspect = 1.5;

export type SvelteKitApp = { root: string };

export type Structure = {
  routes: Route[];
  warnings: Diagnostic[];
  placements: Map<string, Placement>;
  groupOf: Map<string, string>;
  positions: Map<string, Point>;
  depth: Map<string, number>;
  lanes: Lane[];
  groups: ModuleGroup[];
  groupEdges: GroupEdge[];
};

const hasKitMarker = (directory: string) => {
  if (["js", "ts", "mjs", "cjs"].some((ext) => existsSync(path.join(directory, `svelte.config.${ext}`)))) {
    return true;
  }

  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
    return ["dependencies", "devDependencies"].some((field) => {
      const dependencies: unknown =
        typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, field) : undefined;
      return typeof dependencies === "object" && dependencies !== null && "@sveltejs/kit" in dependencies;
    });
  } catch {
    return false;
  }
};

export const findSvelteKitApps = (root: string, paths: readonly string[]): SvelteKitApp[] =>
  [
    ...new Set(
      paths.flatMap((file) => {
        const match = /^(?:(.*)\/)?src\/routes\//.exec(file);
        return match ? [match[1] ?? ""] : [];
      }),
    ),
  ]
    .filter((app) => hasKitMarker(path.join(root, app)))
    .map((app) => ({ root: app }));

const relativeTo = (app: string, file: string) =>
  app === "" ? file : file.startsWith(`${app}/`) ? file.slice(app.length + 1) : undefined;

const appOf = (apps: readonly SvelteKitApp[], file: string) =>
  apps.filter((app) => relativeTo(app.root, file) !== undefined).toSorted((a, b) => b.root.length - a.root.length)[0];

const entryRule = (apps: readonly SvelteKitApp[], file: string) => {
  const app = appOf(apps, file);
  const relative = app && relativeTo(app.root, file);

  return relative === undefined ? undefined : sveltekitEntries.find((rule) => rule.pattern.test(relative));
};

const isServerOnlyByName = (apps: readonly SvelteKitApp[], file: string) => {
  const app = appOf(apps, file);
  const relative = app && relativeTo(app.root, file);

  return (
    relative !== undefined &&
    relative.startsWith("src/") &&
    (relative.startsWith("src/lib/server/") || /\.server\.[^/]+$/.test(relative))
  );
};

export const isTest = (file: string) => testPatterns.some((pattern) => pattern.test(file));

const isTooling = (apps: readonly SvelteKitApp[], file: string) => {
  if (configPattern.test(file)) return true;

  const app = appOf(apps, file);
  const relative = app && relativeTo(app.root, file);

  return relative !== undefined && !relative.startsWith("src/");
};

type Reach = Map<string, string | null>;

const breadthFirst = (starts: readonly string[], next: (node: string) => readonly string[]): Reach => {
  const visit = (frontier: readonly string[], seen: Reach): Reach => {
    if (frontier.length === 0) return seen;

    const discovered = frontier.flatMap((node) =>
      next(node)
        .filter((target) => !seen.has(target))
        .map((target) => [target, node] as const),
    );
    const fresh = [...new Map(discovered.toReversed())];

    fresh.forEach(([target, parent]) => seen.set(target, parent));

    return visit(
      fresh.map(([target]) => target),
      seen,
    );
  };
  return visit(starts, new Map(starts.map((start) => [start, null])));
};

const chainTo = (reach: Reach, file: string): string[] => {
  const parent = reach.get(file);
  return parent === null || parent === undefined ? [file] : [...chainTo(reach, parent), file];
};

const depthFrom = (reach: Reach, file: string): number => chainTo(reach, file).length - 1;

const directoryOf = (file: string) => {
  const slash = file.lastIndexOf("/");
  return slash === -1 ? "." : file.slice(0, slash);
};

const parentDirectory = (directory: string) => (directory.includes("/") ? directoryOf(directory) : ".");

const directoryDepth = (directory: string) => (directory === "." ? 0 : directory.split("/").length);

export const groupDirectories = (files: readonly string[]): Map<string, string> => {
  const initial = new Map(files.map((file) => [file, directoryOf(file)]));
  const directories = [...new Set(initial.values())].toSorted(
    (a, b) => directoryDepth(b) - directoryDepth(a) || a.localeCompare(b),
  );

  return directories.reduce((assignment, directory) => {
    const members = [...assignment].filter(([, assigned]) => assigned === directory);
    return members.length >= minimumGroupSize || directory === "."
      ? assignment
      : members.reduce((next, [file]) => next.set(file, parentDirectory(directory)), assignment);
  }, initial);
};

type Box = { id: string; width: number; height: number; members: { file: string; x: number; y: number }[] };

const layoutGroup = (id: string, files: readonly string[], depth: ReadonlyMap<string, number>): Box => {
  const levels = [...new Set(files.map((file) => depth.get(file) ?? 0))].toSorted((a, b) => a - b);
  const rows = levels.flatMap((level) => {
    const members = files.filter((file) => (depth.get(file) ?? 0) === level).toSorted((a, b) => a.localeCompare(b));
    return Array.from({ length: Math.ceil(members.length / maximumColumns) }, (_, row) =>
      members.slice(row * maximumColumns, (row + 1) * maximumColumns),
    );
  });
  const columns = Math.max(1, ...rows.map((row) => row.length));

  return {
    id,
    width: columns * cell.width + groupPadding.x * 2,
    height: rows.length * cell.height + groupPadding.top + groupPadding.bottom,
    members: rows.flatMap((row, rowIndex) =>
      row.map((file, column) => ({
        file,
        x: groupPadding.x + column * cell.width + cell.width / 2,
        y: groupPadding.top + rowIndex * cell.height + cell.height / 2,
      })),
    ),
  };
};

type Packed = { positions: [string, Point][]; width: number; height: number };

const packLane = (boxes: readonly Box[], targetHeight: number, originX: number): Packed => {
  const step = (
    remaining: readonly Box[],
    state: { x: number; y: number; height: number; columnWidth: number; positions: [string, Point][] },
  ): Packed => {
    const [box, ...rest] = remaining;

    if (!box) {
      return { positions: state.positions, width: state.x + state.columnWidth - originX, height: state.height };
    }

    const wraps = state.y > 0 && state.y + box.height > targetHeight;
    const x = wraps ? state.x + state.columnWidth + gaps.subColumn : state.x;
    const y = wraps ? 0 : state.y;

    return step(rest, {
      x,
      y: y + box.height + gaps.group,
      height: Math.max(state.height, y + box.height),
      columnWidth: wraps ? box.width : Math.max(state.columnWidth, box.width),
      positions: [
        ...state.positions,
        ...box.members.map((member): [string, Point] => [member.file, { x: x + member.x, y: y + member.y }]),
      ],
    });
  };
  return step(boxes, { x: originX, y: 0, height: 0, columnWidth: 0, positions: [] });
};

const routeRoles: readonly { pattern: RegExp; role: RouteRole; side: "client" | "server" }[] = [
  { pattern: /^\+page(@[^/]*)?\.svelte$/, role: "page", side: "client" },
  { pattern: /^\+page\.[jt]s$/, role: "universal-load", side: "client" },
  { pattern: /^\+page\.server\.[jt]s$/, role: "server-load", side: "server" },
  { pattern: /^\+server\.[jt]s$/, role: "endpoint", side: "server" },
  { pattern: /^\+layout(@[^/]*)?\.svelte$/, role: "layout", side: "client" },
  { pattern: /^\+layout\.[jt]s$/, role: "layout-load", side: "client" },
  { pattern: /^\+layout\.server\.[jt]s$/, role: "layout-server-load", side: "server" },
  { pattern: /^\+error\.svelte$/, role: "error", side: "client" },
];

const layoutRoles = new Set<RouteRole>(["layout", "layout-load", "layout-server-load"]);

export const routeUrl = (routeDirectory: string) => {
  const segments = routeDirectory.split("/").filter((segment) => segment !== "" && !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
};

const parentRoute = (directory: string) =>
  directory.includes("/") ? directory.slice(0, directory.lastIndexOf("/")) : "";

const routeAncestors = (directory: string): string[] =>
  directory === "" ? [] : [...routeAncestors(parentRoute(directory)), parentRoute(directory)];

export const findRoutes = (paths: readonly string[], apps: readonly SvelteKitApp[]): Route[] =>
  apps.flatMap((app) => {
    const routesRoot = app.root === "" ? "src/routes" : `${app.root}/src/routes`;
    const files = paths.flatMap((file) => {
      if (!file.startsWith(`${routesRoot}/`) || appOf(apps, file)?.root !== app.root) return [];

      const name = file.slice(file.lastIndexOf("/") + 1);
      const rule = routeRoles.find((candidate) => candidate.pattern.test(name));
      const directory = directoryOf(file).slice(routesRoot.length + 1);

      return rule
        ? [{ directory, file: { role: rule.role, side: rule.side, moduleId: moduleId(file) } satisfies RouteFile }]
        : [];
    });
    const byDirectory = files.reduce(
      (map, entry) => map.set(entry.directory, [...(map.get(entry.directory) ?? []), entry.file]),
      new Map<string, RouteFile[]>(),
    );

    return [...byDirectory]
      .toSorted(([a], [b]) => routeUrl(a).localeCompare(routeUrl(b)) || a.localeCompare(b))
      .map(([directory, routeFiles]) => ({
        id: `route:${routesRoot}/${directory}`,
        app: app.root,
        url: routeUrl(directory),
        directory: directory === "" ? routesRoot : `${routesRoot}/${directory}`,
        files: routeFiles.toSorted((a, b) => a.role.localeCompare(b.role)),
        layouts: routeAncestors(directory).flatMap((ancestor) =>
          (byDirectory.get(ancestor) ?? []).filter((file) => layoutRoles.has(file.role)).map((file) => file.moduleId),
        ),
      }));
  });

const explain = (side: Side, entry: EntryRule | undefined, serverOnlyName: boolean, kit: boolean) => {
  if (entry) return `${entry.label}: an entry point that SvelteKit loads itself.`;

  if (side === "server" && serverOnlyName) {
    return "Server-only by SvelteKit's rules ($lib/server or a .server file name).";
  }

  if (side === "tooling" || side === "unreached" || side === "code" || !kit) {
    return laneInfo[side].description;
  }

  return side === "shared"
    ? "Imported, directly or indirectly, by both client-bundle and server-only entry points."
    : side === "server"
      ? "Imported only by code that starts at server-only entry points."
      : "Imported only by code that starts at components, universal loads or client hooks.";
};

export const buildStructure = (
  paths: readonly string[],
  edges: readonly DependencyEdge[],
  apps: readonly SvelteKitApp[],
): Structure => {
  const running = edges.filter((edge) => !edge.typeOnly);
  const outgoing = running.reduce(
    (map, edge) => map.set(modulePath(edge.from), [...(map.get(modulePath(edge.from)) ?? []), modulePath(edge.to)]),
    new Map<string, string[]>(),
  );
  const importers = new Set(edges.filter((edge) => edge.from !== edge.to).map((edge) => modulePath(edge.to)));
  const next = (file: string) => outgoing.get(file) ?? [];

  const tooling = new Set(paths.filter((file) => isTooling(apps, file)));
  const application = paths.filter((file) => !tooling.has(file));
  const entries = new Map(
    application.flatMap((file) => {
      const rule = entryRule(apps, file);
      return rule ? [[file, rule] as const] : [];
    }),
  );
  const fromClient = breadthFirst(
    [...entries].filter(([, rule]) => rule.side === "client").map(([file]) => file),
    next,
  );
  const fromServer = breadthFirst(
    [...entries].filter(([, rule]) => rule.side === "server").map(([file]) => file),
    next,
  );

  const sideOf = (file: string): Side => {
    if (tooling.has(file)) return "tooling";

    const rule = entries.get(file);

    if (rule) return rule.side;
    if (isServerOnlyByName(apps, file)) return "server";

    const client = fromClient.has(file);
    const server = fromServer.has(file);

    if (client && server) return "shared";
    if (client) return "client";
    if (server) return "server";

    return appOf(apps, file) ? "unreached" : "code";
  };

  const sides = new Map(paths.map((file) => [file, sideOf(file)]));
  const warnings = running.flatMap((edge): Diagnostic[] => {
    const from = modulePath(edge.from);
    const to = modulePath(edge.to);
    const clientSide = fromClient.has(from) && !isServerOnlyByName(apps, from) && !fromServer.has(from);

    return clientSide && isServerOnlyByName(apps, to)
      ? [
          {
            file: from,
            line: edge.occurrences[0]?.line,
            kind: "server-only-import",
            message: `Client-side code imports the server-only module ${to}. SvelteKit refuses to build this.`,
          },
        ]
      : [];
  });
  const roots = paths.filter((file) => entries.has(file) || !importers.has(file));
  const reachFromRoots = breadthFirst(roots, next);
  const depth = new Map(paths.map((file) => [file, reachFromRoots.has(file) ? depthFrom(reachFromRoots, file) : 0]));

  const placements = new Map(
    [...sides].map(([file, side]): [string, Placement] => {
      const rule = entries.get(file);
      const isRoot = side === "code" || side === "tooling";

      return [
        moduleId(file),
        {
          side,
          entry: rule?.label ?? (isRoot && !importers.has(file) ? "Root file: no other file imports it" : null),
          reason: explain(side, rule, isServerOnlyByName(apps, file), appOf(apps, file) !== undefined),
          chains: {
            client: fromClient.has(file) ? chainTo(fromClient, file).map(moduleId) : undefined,
            server: fromServer.has(file) ? chainTo(fromServer, file).map(moduleId) : undefined,
          },
        },
      ];
    }),
  );

  const lanesUsed = laneOrder.filter((side) => paths.some((file) => sides.get(file) === side));
  const groupsBySide = new Map(
    lanesUsed.map((side) => {
      const files = paths.filter((file) => sides.get(file) === side);
      const assignment = groupDirectories(files);
      const directories = [...new Set(assignment.values())];

      return [
        side,
        directories
          .map((directory) => ({
            id: `group:${side}:${directory}`,
            directory,
            files: files.filter((file) => assignment.get(file) === directory),
          }))
          .toSorted(
            (a, b) =>
              Math.min(...a.files.map((file) => depth.get(file) ?? 0)) -
                Math.min(...b.files.map((file) => depth.get(file) ?? 0)) || a.directory.localeCompare(b.directory),
          ),
      ] as const;
    }),
  );

  const boxesBySide = new Map(
    [...groupsBySide].map(([side, groups]) => [side, groups.map((group) => layoutGroup(group.id, group.files, depth))]),
  );
  const allBoxes = [...boxesBySide.values()].flat();
  const packAll = (targetHeight: number) =>
    lanesUsed.reduce<{ x: number; height: number; positions: [string, Point][] }>(
      (state, side) => {
        const lane = packLane(boxesBySide.get(side) ?? [], targetHeight, state.x);
        return {
          x: state.x + lane.width + gaps.lane,
          height: Math.max(state.height, lane.height),
          positions: [...state.positions, ...lane.positions],
        };
      },
      { x: 0, height: 0, positions: [] },
    );
  const tallest = Math.max(1, ...allBoxes.map((box) => box.height));
  const stacked = allBoxes.reduce((sum, box) => sum + box.height + gaps.group, 0);
  const candidates = Array.from(
    { length: 40 },
    (_, step) => tallest * Math.pow(Math.max(stacked / tallest, 1), step / 39),
  );
  const aspectError = (layout: ReturnType<typeof packAll>) =>
    Math.abs(Math.log((layout.x - gaps.lane) / Math.max(layout.height, 1) / targetAspect));
  const packed = candidates
    .map(packAll)
    .reduce((best, layout) => (aspectError(layout) < aspectError(best) ? layout : best));

  const groupOf = new Map(
    [...groupsBySide.values()]
      .flat()
      .flatMap((group) => group.files.map((file) => [moduleId(file), group.id] as const)),
  );
  const groupEdges = [
    ...edges
      .reduce((counts, edge) => {
        const from = groupOf.get(edge.from);
        const to = groupOf.get(edge.to);

        if (!from || !to || from === to) return counts;

        const key = `${from}\u0000${to}`;

        return counts.set(key, { from, to, count: (counts.get(key)?.count ?? 0) + 1 });
      }, new Map<string, GroupEdge>())
      .values(),
  ];

  return {
    routes: findRoutes(paths, apps),
    warnings,
    placements,
    groupOf,
    positions: new Map(packed.positions.map(([file, point]) => [moduleId(file), point])),
    depth: new Map([...depth].map(([file, value]) => [moduleId(file), value])),
    lanes: lanesUsed.map((side) => ({
      side,
      label: laneInfo[side].label,
      description: laneInfo[side].description,
    })),
    groups: [...groupsBySide].flatMap(([side, groups]) =>
      groups.map((group) => ({
        id: group.id,
        side,
        directory: group.directory,
        moduleIds: group.files.map(moduleId),
      })),
    ),
    groupEdges,
  };
};
