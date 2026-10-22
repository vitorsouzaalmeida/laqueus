export type Reexport = { name: string; specifier: string; imported: string };

export type ExportTable = { barrel: boolean; names: string[]; reexports: Reexport[]; stars: string[] };

export type Definition = { file: string; name: string; via: string[] };

export const barrelResolver = (
  tables: ReadonlyMap<string, ExportTable>,
  target: (file: string, specifier: string) => string | undefined,
) => {
  const provides = (file: string, name: string, seen: ReadonlySet<string>): boolean => {
    const table = tables.get(file);

    if (!table || seen.has(file)) return false;

    const next = new Set([...seen, file]);

    return (
      table.names.includes(name) ||
      table.stars.some((star) => {
        const found = target(file, star);
        return found !== undefined && provides(found, name, next);
      })
    );
  };

  const define = (file: string, name: string, via: readonly string[]): Definition => {
    const table = tables.get(file);
    const here = { file, name, via: [...via] };

    if (!table || name === "*" || via.includes(file)) return here;

    const passing = [...via, file];
    const reexport = table.reexports.find((entry) => entry.name === name);

    if (reexport) {
      const next = target(file, reexport.specifier);
      return next === undefined ? here : define(next, reexport.imported, passing);
    }

    if (name === "default" || table.names.includes(name)) return here;

    const star = table.stars
      .map((specifier) => target(file, specifier))
      .find((next) => next !== undefined && provides(next, name, new Set([file])));

    return star === undefined ? here : define(star, name, passing);
  };

  return (file: string, name: string): Definition => define(file, name, []);
};
