import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { LibAlias } from "../language/resolve";
import { breadthFirst, chainTo } from "../graph/reach";
import {
  type DependencyEdge,
  type Diagnostic,
  type Placement,
  type Route,
  type RouteFile,
  type RouteRole,
  type Side,
  directoryOf,
} from "../model";
import { configPattern } from "./files";

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

export type SvelteKitApp = { root: string };

export const libAlias: LibAlias = {
  names: ["$lib", "#lib"],
  folder: ["src", "lib"],
  markers: ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "package.json"],
};

export const frameworkOf = (apps: readonly SvelteKitApp[]) => (apps.length > 0 ? "sveltekit" : null);

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

export const findApps = (root: string, paths: readonly string[]): SvelteKitApp[] =>
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

const isTooling = (apps: readonly SvelteKitApp[], file: string) => {
  if (configPattern.test(file)) return true;

  const app = appOf(apps, file);
  const relative = app && relativeTo(app.root, file);

  return relative !== undefined && !relative.startsWith("src/");
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
        ? [{ directory, file: { role: rule.role, side: rule.side, moduleId: file } satisfies RouteFile }]
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

export type Placed = { placements: Map<string, Placement>; warnings: Diagnostic[] };

export const placeFiles = (
  paths: readonly string[],
  edges: readonly DependencyEdge[],
  apps: readonly SvelteKitApp[],
): Placed => {
  const running = edges.filter((edge) => !edge.typeOnly);
  const outgoing = running.reduce(
    (map, edge) => map.set(edge.from, [...(map.get(edge.from) ?? []), edge.to]),
    new Map<string, string[]>(),
  );
  const importers = new Set(edges.filter((edge) => edge.from !== edge.to).map((edge) => edge.to));
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

  const warnings = running.flatMap((edge): Diagnostic[] => {
    const clientSide = fromClient.has(edge.from) && !isServerOnlyByName(apps, edge.from) && !fromServer.has(edge.from);

    return clientSide && isServerOnlyByName(apps, edge.to)
      ? [
          {
            file: edge.from,
            line: edge.occurrences[0]?.line,
            kind: "server-only-import",
            message: `Client-side code imports the server-only module ${edge.to}. SvelteKit refuses to build this.`,
          },
        ]
      : [];
  });

  const placements = new Map(
    paths.map((file): [string, Placement] => {
      const side = sideOf(file);
      const rule = entries.get(file);
      const isRoot = side === "code" || side === "tooling";

      return [
        file,
        {
          side,
          entry: rule?.label ?? (isRoot && !importers.has(file) ? "Root file: no other file imports it" : null),
          chains: {
            client: fromClient.has(file) ? chainTo(fromClient, file) : undefined,
            server: fromServer.has(file) ? chainTo(fromServer, file) : undefined,
          },
        },
      ];
    }),
  );

  return { placements, warnings };
};
