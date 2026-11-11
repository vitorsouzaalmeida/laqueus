import { existsSync } from "node:fs";
import { builtinModules } from "node:module";
import path from "node:path";
import ts from "typescript";

export type Resolution =
  | { kind: "local"; file: string }
  | { kind: "external"; name: string }
  | { kind: "ignored" }
  | { kind: "unresolved"; reason: string };

export type Resolver = (specifier: string, importer: string) => Resolution;

type ProjectConfig = {
  configDir: string;
  options: ts.CompilerOptions;
  bundlerOptions: ts.CompilerOptions;
  cache: ts.ModuleResolutionCache;
  bundlerCache: ts.ModuleResolutionCache;
  references: string[];
  files: ReadonlySet<string>;
};

const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".svelte"];
const scriptExtensions = new Set([...codeExtensions, ".mjs", ".cjs", ".mts", ".cts"]);
const extensionSwaps: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const configNames = ["tsconfig.json", "jsconfig.json"];

export type LibAlias = {
  names: readonly string[];
  folder: readonly string[];
  markers: readonly string[];
  virtual: readonly RegExp[];
};

const defaultOptions: ts.CompilerOptions = {
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  allowJs: true,
  resolveJsonModule: true,
  allowImportingTsExtensions: true,
  noEmit: true,
};

const configHost: ts.ParseConfigHost = {
  useCaseSensitiveFileNames: ts.sys.useCaseSensitiveFileNames,
  readDirectory: () => [],
  fileExists: (file) => ts.sys.fileExists(file),
  readFile: (file) => ts.sys.readFile(file),
};

const listingHost: ts.ParseConfigHost = {
  ...configHost,
  readDirectory: (directory, extensions, excludes, includes, depth) =>
    ts.sys.readDirectory(directory, extensions, excludes, includes, depth),
};

const svelteFiles: ts.FileExtensionInfo[] = [
  { extension: ".svelte", isMixedContent: true, scriptKind: ts.ScriptKind.Deferred },
];

const stripQuery = (specifier: string) => specifier.replace(/\?.*$/, "");

const codeQuery = /[?&](worker|sharedworker)(&|$)/;

const isNonCodeQuery = (specifier: string) => specifier.includes("?") && !codeQuery.test(specifier);

const isAliasLike = (specifier: string) => /^(\$[^/]+|~|@)\//.test(specifier);

const isRelative = (specifier: string) =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier === "." ||
  specifier === ".." ||
  path.isAbsolute(specifier);

const libAliasRest = (alias: LibAlias, specifier: string): string | undefined =>
  alias.names
    .filter((name) => specifier === name || specifier.startsWith(`${name}/`))
    .map((name) => specifier.slice(name.length + 1))[0];

const isAsset = (specifier: string) => {
  const extension = path.extname(stripQuery(specifier));
  return specifier.includes("?") || (extension !== "" && !scriptExtensions.has(extension));
};

const builtins = new Set(builtinModules);

const packageName = (specifier: string): string | undefined => {
  if (/^[$#~]|^[a-z][a-z0-9+.-]*:/i.test(specifier) || isRelative(specifier)) return undefined;

  const segments = specifier.split("/");
  const scoped = specifier.startsWith("@");
  const name = scoped ? segments.slice(0, 2).join("/") : segments[0];

  return name && !builtins.has(name) && (!scoped || /^@[^/]+\/[^/]+/.test(specifier)) ? name : undefined;
};

const ancestorsWithin = (dir: string, root: string): string[] =>
  dir === root || !dir.startsWith(`${root}${path.sep}`) ? [root] : [dir, ...ancestorsWithin(path.dirname(dir), root)];

const memoize = <T>(compute: (key: string) => T): ((key: string) => T) => {
  const cache = new Map<string, T>();
  return (key) => {
    const cached = cache.get(key);

    if (cached !== undefined || cache.has(key)) return cached as T;

    const value = compute(key);
    cache.set(key, value);

    return value;
  };
};

const canonical = (name: string) => (ts.sys.useCaseSensitiveFileNames ? name : name.toLowerCase());

const validPaths = (paths: unknown): ts.MapLike<string[]> | undefined => {
  if (typeof paths !== "object" || paths === null) return undefined;

  return Object.fromEntries(
    Object.entries(paths).flatMap(([pattern, targets]: [string, unknown]) =>
      Array.isArray(targets)
        ? [[pattern, targets.filter((target): target is string => typeof target === "string")] as const]
        : [],
    ),
  );
};

const loadConfig = (configPath: string, listFiles: boolean): ProjectConfig => {
  const configDir = path.dirname(configPath);
  const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  const parsed = read.error
    ? undefined
    : ts.parseJsonConfigFileContent(
        read.config,
        listFiles ? listingHost : configHost,
        configDir,
        undefined,
        configPath,
        undefined,
        svelteFiles,
      );
  const { paths, ...rest } = parsed?.options ?? {};
  const checkedPaths = validPaths(paths);
  const options: ts.CompilerOptions = {
    ...defaultOptions,
    ...rest,
    ...(checkedPaths ? { paths: checkedPaths } : {}),
    allowJs: true,
    allowImportingTsExtensions: true,
    noEmit: true,
  };
  const bundlerOptions: ts.CompilerOptions = {
    ...options,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };

  return {
    configDir,
    options,
    bundlerOptions,
    cache: ts.createModuleResolutionCache(configDir, canonical, options),
    bundlerCache: ts.createModuleResolutionCache(configDir, canonical, bundlerOptions),
    references: (parsed?.projectReferences ?? []).map((reference) => ts.resolveProjectReferencePath(reference)),
    files: new Set(listFiles ? (parsed?.fileNames ?? []).map((file) => path.resolve(file)) : []),
  };
};

const defaultConfig = (root: string): ProjectConfig => ({
  configDir: root,
  options: defaultOptions,
  bundlerOptions: defaultOptions,
  cache: ts.createModuleResolutionCache(root, (name) => name, defaultOptions),
  bundlerCache: ts.createModuleResolutionCache(root, (name) => name, defaultOptions),
  references: [],
  files: new Set(),
});

const pathPatternMatches = (pattern: string, specifier: string): string | undefined => {
  const star = pattern.indexOf("*");

  if (star === -1) return pattern === specifier ? "" : undefined;

  const prefix = pattern.slice(0, star);
  const suffix = pattern.slice(star + 1);

  return specifier.length >= prefix.length + suffix.length && specifier.startsWith(prefix) && specifier.endsWith(suffix)
    ? specifier.slice(prefix.length, specifier.length - suffix.length)
    : undefined;
};

const pathMatches = (config: ProjectConfig, specifier: string): { pattern: string; base: string }[] => {
  const paths = config.options.paths ?? {};
  const pathsBase = config.options["pathsBasePath"];
  const base = config.options.baseUrl ?? (typeof pathsBase === "string" ? pathsBase : config.configDir);

  return Object.entries(paths).flatMap(([pattern, targets]) => {
    const captured = pathPatternMatches(pattern, specifier);
    return captured === undefined
      ? []
      : targets.map((target) => ({ pattern, base: path.resolve(base, target.replace("*", captured)) }));
  });
};

const typescriptResolve = (specifier: string, importer: string, config: ProjectConfig): string | undefined => {
  const attempt = (options: ts.CompilerOptions, cache: ts.ModuleResolutionCache) =>
    ts.resolveModuleName(specifier, importer, options, ts.sys, cache).resolvedModule?.resolvedFileName;
  return attempt(config.options, config.cache) ?? attempt(config.bundlerOptions, config.bundlerCache);
};

export const createResolver = (root: string, sourceFiles: ReadonlySet<string>, alias: LibAlias): Resolver => {
  const fallbackConfig = defaultConfig(root);

  const configForDir = memoize((dir: string): ProjectConfig => {
    const found = configNames.map((name) => path.join(dir, name)).find((candidate) => existsSync(candidate));
    return found
      ? loadConfig(found, false)
      : dir === root || !dir.startsWith(root)
        ? fallbackConfig
        : configForDir(path.dirname(dir));
  });

  const referencedConfig = memoize((configPath: string) =>
    existsSync(configPath) ? loadConfig(configPath, true) : undefined,
  );

  const configFor = (importer: string) => {
    const nearest = configForDir(path.dirname(importer));

    return (
      nearest.references
        .flatMap((reference) => referencedConfig(reference) ?? [])
        .find((config) => config.files.has(importer)) ?? nearest
    );
  };

  const appRootForDir = memoize(
    (dir: string): string =>
      ancestorsWithin(dir, root).find((candidate) =>
        alias.markers.some((marker) => existsSync(path.join(candidate, marker))),
      ) ?? root,
  );

  const findSource = (base: string): string | undefined => {
    const extension = path.extname(base);
    const swapped = (extensionSwaps[extension] ?? []).map(
      (replacement) => base.slice(0, -extension.length) + replacement,
    );

    return [
      base,
      ...swapped,
      ...codeExtensions.map((ext) => base + ext),
      ...codeExtensions.map((ext) => path.join(base, `index${ext}`)),
    ].find((candidate) => sourceFiles.has(candidate));
  };

  const manualResolve = (specifier: string, importer: string, config: ProjectConfig) => {
    const clean = stripQuery(specifier);
    const aliasRest = libAliasRest(alias, clean);
    const baseUrl = config.options.baseUrl;
    const bases = [
      ...(isRelative(clean) ? [path.resolve(path.dirname(importer), clean)] : []),
      ...pathMatches(config, clean).map((match) => match.base),
      ...(aliasRest === undefined
        ? []
        : [path.join(appRootForDir(path.dirname(importer)), ...alias.folder, aliasRest)]),
      ...(baseUrl === undefined || isRelative(clean) ? [] : [path.resolve(baseUrl, clean)]),
    ];

    return bases.map(findSource).find((found) => found !== undefined);
  };

  const looksLocal = (specifier: string, config: ProjectConfig) => {
    const clean = stripQuery(specifier);

    return (
      isRelative(clean) ||
      clean.startsWith("#") ||
      isAliasLike(clean) ||
      libAliasRest(alias, clean) !== undefined ||
      pathMatches(config, clean).some((match) => match.pattern !== "*" || findSource(match.base) !== undefined)
    );
  };

  return (specifier, importer) => {
    if (alias.virtual.some((pattern) => pattern.test(specifier)) || isNonCodeQuery(specifier)) {
      return { kind: "ignored" };
    }

    const config = configFor(importer);
    const viaTypescript = typescriptResolve(specifier, importer, config);

    if (viaTypescript !== undefined && sourceFiles.has(viaTypescript)) {
      return { kind: "local", file: viaTypescript };
    }

    const viaFallback = manualResolve(specifier, importer, config);

    if (viaFallback !== undefined) return { kind: "local", file: viaFallback };

    const local = looksLocal(specifier, config);
    const external = local ? undefined : packageName(stripQuery(specifier));

    if (external !== undefined) return { kind: "external", name: external };

    if (viaTypescript !== undefined || isAsset(specifier) || !local) {
      return { kind: "ignored" };
    }

    return { kind: "unresolved", reason: `Cannot resolve "${specifier}" to a source file` };
  };
};
