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
};

const codeExtensions = [".ts", ".tsx", ".js", ".jsx", ".svelte"];
const scriptExtensions = new Set([...codeExtensions, ".mjs", ".cjs", ".mts", ".cts"]);
const extensionSwaps: Readonly<Record<string, readonly string[]>> = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const libAliases = ["$lib", "#lib"];
const configNames = ["tsconfig.json", "jsconfig.json"];
const appMarkers = ["svelte.config.js", "svelte.config.ts", "svelte.config.mjs", "package.json"];

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

const stripQuery = (specifier: string) => specifier.replace(/\?.*$/, "");

const isRelative = (specifier: string) =>
  specifier.startsWith("./") ||
  specifier.startsWith("../") ||
  specifier === "." ||
  specifier === ".." ||
  path.isAbsolute(specifier);

const libAliasRest = (specifier: string): string | undefined =>
  libAliases
    .filter((alias) => specifier === alias || specifier.startsWith(`${alias}/`))
    .map((alias) => specifier.slice(alias.length + 1))[0];

const isAsset = (specifier: string) => {
  const extension = path.extname(stripQuery(specifier));
  return specifier.includes("?") || (extension !== "" && !scriptExtensions.has(extension));
};

const builtins = new Set(builtinModules);

const packageName = (specifier: string): string | undefined => {
  if (/^[$#~]|^[a-z][a-z0-9+.-]*:/i.test(specifier) || isRelative(specifier)) return undefined;

  const segments = specifier.split("/");
  const name = specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0];

  return name && !builtins.has(name) && (!specifier.startsWith("@") || segments.length > 1) ? name : undefined;
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

const loadConfig = (configPath: string): ProjectConfig => {
  const configDir = path.dirname(configPath);
  const read = ts.readConfigFile(configPath, (file) => ts.sys.readFile(file));
  const parsed = read.error
    ? undefined
    : ts.parseJsonConfigFileContent(read.config, configHost, configDir, undefined, configPath);
  const options: ts.CompilerOptions = {
    ...defaultOptions,
    ...parsed?.options,
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
  };
};

const defaultConfig = (root: string): ProjectConfig => ({
  configDir: root,
  options: defaultOptions,
  bundlerOptions: defaultOptions,
  cache: ts.createModuleResolutionCache(root, (name) => name, defaultOptions),
  bundlerCache: ts.createModuleResolutionCache(root, (name) => name, defaultOptions),
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

const pathMappedBases = (config: ProjectConfig, specifier: string): string[] => {
  const paths = config.options.paths ?? {};
  const pathsBase = config.options["pathsBasePath"];
  const base = config.options.baseUrl ?? (typeof pathsBase === "string" ? pathsBase : config.configDir);

  return Object.entries(paths).flatMap(([pattern, targets]) => {
    const captured = pathPatternMatches(pattern, specifier);
    return captured === undefined ? [] : targets.map((target) => path.resolve(base, target.replace("*", captured)));
  });
};

const typescriptResolve = (specifier: string, importer: string, config: ProjectConfig): string | undefined => {
  const attempt = (options: ts.CompilerOptions, cache: ts.ModuleResolutionCache) =>
    ts.resolveModuleName(specifier, importer, options, ts.sys, cache).resolvedModule?.resolvedFileName;
  return attempt(config.options, config.cache) ?? attempt(config.bundlerOptions, config.bundlerCache);
};

const looksLocal = (specifier: string, config: ProjectConfig) =>
  isRelative(specifier) ||
  specifier.startsWith("#") ||
  libAliasRest(specifier) !== undefined ||
  pathMappedBases(config, stripQuery(specifier)).length > 0;

export const createResolver = (root: string, sourceFiles: ReadonlySet<string>): Resolver => {
  const fallbackConfig = defaultConfig(root);

  const configForDir = memoize((dir: string): ProjectConfig => {
    const found = configNames.map((name) => path.join(dir, name)).find((candidate) => existsSync(candidate));
    return found
      ? loadConfig(found)
      : dir === root || !dir.startsWith(root)
        ? fallbackConfig
        : configForDir(path.dirname(dir));
  });

  const appRootForDir = memoize(
    (dir: string): string =>
      ancestorsWithin(dir, root).find((candidate) =>
        appMarkers.some((marker) => existsSync(path.join(candidate, marker))),
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
    const aliasRest = libAliasRest(clean);
    const bases = [
      ...(isRelative(clean) ? [path.resolve(path.dirname(importer), clean)] : []),
      ...pathMappedBases(config, clean),
      ...(aliasRest === undefined ? [] : [path.join(appRootForDir(path.dirname(importer)), "src", "lib", aliasRest)]),
    ];

    return bases.map(findSource).find((found) => found !== undefined);
  };

  return (specifier, importer) => {
    const config = configForDir(path.dirname(importer));
    const viaTypescript = typescriptResolve(specifier, importer, config);

    if (viaTypescript !== undefined && sourceFiles.has(viaTypescript)) {
      return { kind: "local", file: viaTypescript };
    }

    const viaFallback = manualResolve(specifier, importer, config);

    if (viaFallback !== undefined) return { kind: "local", file: viaFallback };

    const external = looksLocal(specifier, config) ? undefined : packageName(stripQuery(specifier));

    if (external !== undefined) return { kind: "external", name: external };

    if (viaTypescript !== undefined || isAsset(specifier) || !looksLocal(specifier, config)) {
      return { kind: "ignored" };
    }

    return { kind: "unresolved", reason: `Cannot resolve "${specifier}" to a source file` };
  };
};
