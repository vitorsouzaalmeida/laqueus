import { groupBy } from "./dom";
import { type Look, type Scene, type SceneEdge, plainLook } from "./scene";

type SceneIndex = {
  ids: string[];
  nodeIds: ReadonlySet<string>;
  edgeById: ReadonlyMap<string, SceneEdge>;
  outOf: ReadonlyMap<string, SceneEdge[]>;
  into: ReadonlyMap<string, SceneEdge[]>;
};

const cached = <T>(build: (scene: Scene) => T) => {
  const store = new WeakMap<Scene, T>();
  return (scene: Scene): T => {
    const known = store.get(scene);
    if (known) return known;
    const fresh = build(scene);
    store.set(scene, fresh);
    return fresh;
  };
};

const indexOf = cached(
  (scene): SceneIndex => ({
    ids: [...scene.nodes.map((node) => node.id), ...scene.edges.map((edge) => edge.id)],
    nodeIds: new Set(scene.nodes.map((node) => node.id)),
    edgeById: new Map(scene.edges.map((edge) => [edge.id, edge])),
    outOf: groupBy(scene.edges, (edge) => edge.source),
    into: groupBy(scene.edges, (edge) => edge.target),
  }),
);

const touching = (index: SceneIndex, id: string) => [...(index.outOf.get(id) ?? []), ...(index.into.get(id) ?? [])];

const dimExcept = (scene: Scene, keep: ReadonlySet<string>) => new Set(indexOf(scene).ids.filter((id) => !keep.has(id)));

/** The element plus its direct neighbours, with the edges in between. */
export const closedNeighbourhood = (scene: Scene, id: string): Set<string> | null => {
  const index = indexOf(scene);
  const edge = index.edgeById.get(id);
  if (edge) return new Set([edge.id, edge.source, edge.target]);
  if (!index.nodeIds.has(id)) return null;
  return new Set([id, ...touching(index, id).flatMap((candidate) => [candidate.id, candidate.source, candidate.target])]);
};

/** Hovering or selecting dims everything outside the neighbourhood and colours edges by direction. */
export const neighbourhoodLook = (scene: Scene, focus: string | null, hidden: ReadonlySet<string> = plainLook.hidden): Look => {
  const around = focus === null ? null : closedNeighbourhood(scene, focus);
  if (focus === null || around === null) return { ...plainLook, hidden };
  const index = indexOf(scene);
  const isEdge = index.edgeById.has(focus);
  return {
    ...plainLook,
    hidden,
    dim: dimExcept(scene, around),
    outgoing: isEdge ? new Set([focus]) : new Set((index.outOf.get(focus) ?? []).map((edge) => edge.id)),
    incoming: isEdge ? plainLook.incoming : new Set((index.into.get(focus) ?? []).map((edge) => edge.id)),
  };
};

/** In focus mode only the selection's neighbourhood stays visible. */
export const functionsLook = (scene: Scene, focus: string | null, selected: string | null, focusMode: boolean): Look => {
  const around = focusMode && selected !== null ? closedNeighbourhood(scene, selected) : null;
  const hidden = around === null ? plainLook.hidden : new Set(scene.nodes.filter((node) => !around.has(node.id)).map((node) => node.id));
  return neighbourhoodLook(scene, focus, hidden);
};

const reach = (index: SceneIndex, start: string, forward: boolean): ReadonlySet<string> => {
  const step = (frontier: readonly string[], seen: ReadonlySet<string>): ReadonlySet<string> => {
    const next = frontier
      .flatMap((id) => (forward ? index.outOf : index.into).get(id) ?? [])
      .filter((edge) => !seen.has(edge.id));
    if (next.length === 0) return seen;
    const nodes = [...new Set(next.map((edge) => (forward ? edge.target : edge.source)))].filter((id) => !seen.has(id));
    return step(nodes, new Set([...seen, ...next.map((edge) => edge.id), ...nodes]));
  };
  return step([start], new Set());
};

/** Everything that can lead to the selection and everything it can lead to. */
export const pathLook = (scene: Scene, focus: string | null): Look => {
  if (focus === null) return plainLook;
  const index = indexOf(scene);
  const edge = index.edgeById.get(focus);
  if (!edge && !index.nodeIds.has(focus)) return plainLook;
  const along = edge
    ? new Set([edge.id, edge.source, edge.target, ...reach(index, edge.source, false), ...reach(index, edge.target, true)])
    : new Set([focus, ...reach(index, focus, false), ...reach(index, focus, true)]);
  return { ...plainLook, dim: dimExcept(scene, along), path: along };
};
