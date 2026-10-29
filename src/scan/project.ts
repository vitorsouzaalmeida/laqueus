import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { detectAreas } from "../graph/areas";
import { fileCoupling } from "../graph/coupling";
import { toPosix } from "../language/ast";
import { barrelResolver } from "../language/barrels";
import { fileComplexity } from "../language/complexity";
import { type FileAnalysis, analyzeSource } from "../language/file";
import { createResolver } from "../language/resolve";
import { isComponent } from "../language/svelte";
import {
  type Area,
  type DependencyEdge,
  type Diagnostic,
  type FunctionNode,
  type GraphSnapshot,
  type Location,
  type Result,
  err,
  errorMessage,
  ok,
  sideInfo,
} from "../model";
import { discoverSourceFiles, isTest } from "./files";
import { folderGroups } from "./groups";
import { findApps, findRoutes, frameworkOf, libAlias, placeFiles } from "./sveltekit";

type ImportSite = {
  from: string;
  to: string;
  location: Location;
  names: readonly string[];
  via: readonly string[];
  typeOnly: boolean;
};

const merged = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])].toSorted();

const groupDependencyEdges = (sites: readonly ImportSite[]): DependencyEdge[] => [
  ...sites
    .reduce((map, site) => {
      const key = `${site.from}\u0000${site.to}`;
      const known = map.get(key);
      return map.set(key, {
        kind: "imports",
        from: site.from,
        to: site.to,
        occurrences: [...(known?.occurrences ?? []), site.location],
        names: merged(known?.names ?? [], site.names),
        via: merged(known?.via ?? [], site.via),
        typeOnly: (known?.typeOnly ?? true) && site.typeOnly,
      });
    }, new Map<string, DependencyEdge>())
    .values(),
];

/** Reads a value every module is guaranteed to have; a miss is a bug in the analysis, not a property of the project. */
const required = <V>(map: ReadonlyMap<string, V>, id: string, what: string): V => {
  const value = map.get(id);

  if (value === undefined) throw new Error(`No ${what} computed for ${id}`);

  return value;
};

const validateRoot = async (input: string): Promise<Result<string>> => {
  const resolved = await realpath(path.resolve(input)).catch(() => undefined);

  if (resolved === undefined) return err(`Path does not exist: ${input}`);

  const info = await stat(resolved);

  return info.isDirectory() ? ok(resolved) : err(`Path is not a directory: ${input}`);
};

export const analyzeProject = async (input: string): Promise<Result<GraphSnapshot>> => {
  const started = performance.now();
  const rootResult = await validateRoot(input);

  if (!rootResult.ok) return rootResult;

  const root = rootResult.value;
  const discovered = await discoverSourceFiles(root);
  const relative = (absolute: string) => toPosix(path.relative(root, absolute));
  const tests = new Set(discovered.filter((absolute) => isTest(relative(absolute))));
  const files = discovered.filter((absolute) => !tests.has(absolute));

  const results = await Promise.all(
    files.map(async (absolute): Promise<Result<FileAnalysis, Diagnostic>> => {
      const code = await readFile(absolute, "utf8").catch((error: unknown) => error);
      return typeof code === "string"
        ? analyzeSource(root, absolute, code)
        : err({ file: relative(absolute), kind: "parse-error", message: errorMessage(code) });
    }),
  );
  const analyses = results.flatMap((result) => (result.ok ? [result.value] : []));
  const parseDiagnostics = results.flatMap((result) => (result.ok ? [] : [result.error]));

  const resolve = createResolver(root, new Set(discovered), libAlias);
  const resolutions = analyses.flatMap((analysis) =>
    analysis.imports.flatMap((reference) => {
      const resolution = resolve(reference.specifier, path.join(root, analysis.path));

      return resolution.kind === "local" && tests.has(resolution.file)
        ? []
        : [{ reference, importer: analysis.path, resolution }];
    }),
  );
  const targets = new Map(
    resolutions.flatMap(({ reference, importer, resolution }) =>
      resolution.kind === "local"
        ? [[`${importer}\u0000${reference.specifier}`, relative(resolution.file)] as const]
        : [],
    ),
  );
  const exportTables = new Map(analyses.map((analysis) => [analysis.path, analysis.exports]));
  const define = barrelResolver(exportTables, (file, specifier) => targets.get(`${file}\u0000${specifier}`));
  const localImports = resolutions.flatMap(({ reference, importer, resolution }) =>
    resolution.kind === "local" ? [{ reference, importer, file: relative(resolution.file) }] : [],
  );
  const importEdges = groupDependencyEdges(
    localImports.map(({ reference, importer, file }) => ({
      from: importer,
      to: file,
      location: reference.location,
      names: reference.names,
      via: [],
      typeOnly: reference.typeOnly,
    })),
  );
  const dependencyEdges = groupDependencyEdges(
    localImports.flatMap(({ reference, importer, file }) =>
      [
        ...reference.names
          .map((name) => define(file, name))
          .reduce(
            (map, definition) => map.set(definition.file, [...(map.get(definition.file) ?? []), definition]),
            new Map<string, ReturnType<typeof define>[]>(),
          ),
      ].flatMap(([target, definitions]): ImportSite[] => {
        const via = [...new Set(definitions.flatMap((definition) => definition.via))];

        return target === importer && via.length > 0
          ? []
          : [
              {
                from: importer,
                to: target,
                location: reference.location,
                names: definitions.map((definition) => definition.name),
                via,
                typeOnly: reference.typeOnly,
              },
            ];
      }),
    ),
  );
  const importDiagnostics = resolutions.flatMap(({ reference, importer, resolution }): Diagnostic[] =>
    resolution.kind === "unresolved"
      ? [
          {
            file: importer,
            line: reference.location.line,
            kind: "unresolved-import",
            message: resolution.reason,
          },
        ]
      : [],
  );
  const selfImports = dependencyEdges.flatMap((edge): Diagnostic[] => {
    const file = edge.from;

    return edge.from === edge.to && !isComponent(file)
      ? [{ file, line: edge.occurrences[0]?.line, kind: "self-import", message: "This file imports itself." }]
      : [];
  });

  const externalsByModule = resolutions.reduce((map, { importer, resolution }) => {
    if (resolution.kind !== "external") return map;

    const id = importer;

    return map.set(id, new Set([...(map.get(id) ?? []), resolution.name]));
  }, new Map<string, Set<string>>());

  const functions = analyses.flatMap((analysis) => analysis.functions);
  const functionsByModule = analyses.reduce(
    (map, analysis) => map.set(analysis.path, analysis.functions),
    new Map<string, FunctionNode[]>(),
  );
  const modulePaths = files.map(relative);
  const apps = findApps(root, modulePaths);
  const placed = placeFiles(modulePaths, importEdges, apps);
  const sideOf = (file: string) => required(placed.placements, file, "placement").side;
  const sides = sideInfo(apps.length > 0).filter((info) => modulePaths.some((file) => sideOf(file) === info.side));
  const { groups, groupOf } = folderGroups(
    modulePaths,
    sideOf,
    sides.map((info) => info.side),
  );
  const coupling = fileCoupling(modulePaths, dependencyEdges);
  const areas: Area[] = sides
    .filter((info) => info.grouping === "areas")
    .flatMap((info) =>
      detectAreas(
        modulePaths.filter((file) => sideOf(file) === info.side),
        dependencyEdges,
        info.side,
      ),
    );
  const areaOf = new Map(
    areas.flatMap((area) =>
      area.moduleIds.map((id) => [`${area.parent === null ? "top" : "sub"}:${id}`, area.id] as const),
    ),
  );

  return ok({
    root,
    name: path.basename(root),
    scannedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - started),
    framework: frameworkOf(apps),
    sides,
    groups,
    areas,
    routes: findRoutes(modulePaths, apps),
    modules: modulePaths.map((id) => ({
      id,
      path: id,
      metrics: {
        ...required(coupling, id, "coupling"),
        ...fileComplexity((functionsByModule.get(id) ?? []).map((fn) => fn.complexity)),
      },
      placement: required(placed.placements, id, "placement"),
      groupId: required(groupOf, id, "group"),
      areaId: areaOf.get(`top:${id}`) ?? null,
      subAreaId: areaOf.get(`sub:${id}`) ?? null,
      externals: [...(externalsByModule.get(id) ?? [])].toSorted(),
      barrel: exportTables.get(id)?.barrel ?? false,
    })),
    functions,
    classes: analyses.flatMap((analysis) => analysis.classes),
    dependencyEdges,
    callEdges: analyses.flatMap((analysis) => analysis.calls),
    diagnostics: [...parseDiagnostics, ...importDiagnostics, ...selfImports, ...placed.warnings],
  });
};
