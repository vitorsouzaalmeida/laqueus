import { type Edge, cycleGroups, setsBy } from "./cycles";
import { visibility } from "./visibility";

export type Coupling = {
  fanIn: number;
  fanOut: number;
  visibilityFanIn: number;
  visibilityFanOut: number;
  cycleGroup: number | null;
};

export const fileCoupling = (ids: readonly string[], edges: readonly Edge[]): Map<string, Coupling> => {
  const cycles = cycleGroups(ids, edges);
  const reach = visibility(ids, edges);
  const external = edges.filter((edge) => edge.from !== edge.to);
  const importers = setsBy(external.map((edge) => [edge.to, edge.from] as const));
  const imported = setsBy(external.map((edge) => [edge.from, edge.to] as const));

  return new Map(
    ids.map((id) => [
      id,
      {
        fanIn: importers.get(id)?.size ?? 0,
        fanOut: imported.get(id)?.size ?? 0,
        visibilityFanIn: reach.get(id)?.fanIn ?? 1,
        visibilityFanOut: reach.get(id)?.fanOut ?? 1,
        cycleGroup: cycles.get(id) ?? null,
      },
    ]),
  );
};
