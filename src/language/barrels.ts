export type Reexport = { name: string; specifier: string; imported: string; typeOnly: boolean };

export type ExportTable = {
  barrel: boolean;
  names: string[];
  reexports: Reexport[];
  stars: string[];
  typeStars: string[];
};

export type Definition = { file: string; name: string; via: string[]; typeOnly: boolean };

export const barrelResolver = (
  tables: ReadonlyMap<string, ExportTable>,
  target: (file: string, specifier: string) => string | undefined,
) => {
  const starsOf = (table: ExportTable) => [
    ...table.stars.map((specifier) => ({ specifier, typeOnly: false })),
    ...table.typeStars.map((specifier) => ({ specifier, typeOnly: true })),
  ];

  const provides = (file: string, name: string, seen: ReadonlySet<string>): boolean => {
    const table = tables.get(file);

    if (!table || seen.has(file)) return false;

    const next = new Set([...seen, file]);

    return (
      table.names.includes(name) ||
      starsOf(table).some((star) => {
        const found = target(file, star.specifier);
        return found !== undefined && provides(found, name, next);
      })
    );
  };

  const define = (file: string, name: string, via: readonly string[], typeOnly: boolean): Definition => {
    const table = tables.get(file);
    const here = { file, name, via: [...via], typeOnly };

    if (!table || name === "*" || via.includes(file)) return here;

    const passing = [...via, file];
    const reexport = table.reexports.find((entry) => entry.name === name);

    if (reexport) {
      const next = target(file, reexport.specifier);
      return next === undefined ? here : define(next, reexport.imported, passing, typeOnly || reexport.typeOnly);
    }

    if (name === "default" || table.names.includes(name)) return here;

    const star = starsOf(table)
      .map((entry) => ({ next: target(file, entry.specifier), typeOnly: entry.typeOnly }))
      .find((entry) => entry.next !== undefined && provides(entry.next, name, new Set([file])));

    return star?.next === undefined ? here : define(star.next, name, passing, typeOnly || star.typeOnly);
  };

  return (file: string, name: string): Definition => define(file, name, [], false);
};
