import { type Look, type Scene, type SceneEdge, plainLook } from "./scene";

const allIds = (scene: Scene) => [...scene.nodes.map((node) => node.id), ...scene.edges.map((edge) => edge.id)];

const dimExcept = (scene: Scene, keep: ReadonlySet<string>) => new Set(allIds(scene).filter((id) => !keep.has(id)));

/** The element plus its direct neighbours, with the edges in between. */
export const closedNeighbourhood = (scene: Scene, id: string): Set<string> | null => {
  const edge = scene.edges.find((candidate) => candidate.id === id);
  if (edge) return new Set([edge.id, edge.source, edge.target]);
  if (!scene.nodes.some((node) => node.id === id)) return null;
  return new Set([
    id,
    ...scene.edges
      .filter((candidate) => candidate.source === id || candidate.target === id)
      .flatMap((candidate) => [candidate.id, candidate.source, candidate.target]),
  ]);
};

/** Hovering or selecting dims everything outside the neighbourhood and colours edges by direction. */
export const neighbourhoodLook = (scene: Scene, focus: string | null, hidden: ReadonlySet<string> = plainLook.hidden): Look => {
  const around = focus === null ? null : closedNeighbourhood(scene, focus);
  if (focus === null || around === null) return { ...plainLook, hidden };
  const isEdge = scene.edges.some((edge) => edge.id === focus);
  return {
    ...plainLook,
    hidden,
    dim: dimExcept(scene, around),
    outgoing: isEdge ? new Set([focus]) : new Set(scene.edges.filter((edge) => edge.source === focus).map((edge) => edge.id)),
    incoming: isEdge ? plainLook.incoming : new Set(scene.edges.filter((edge) => edge.target === focus).map((edge) => edge.id)),
  };
};

/** In focus mode only the selection's neighbourhood stays visible. */
export const functionsLook = (scene: Scene, focus: string | null, selected: string | null, focusMode: boolean): Look => {
  const around = focusMode && selected !== null ? closedNeighbourhood(scene, selected) : null;
  const hidden = around === null ? plainLook.hidden : new Set(scene.nodes.filter((node) => !around.has(node.id)).map((node) => node.id));
  return neighbourhoodLook(scene, focus, hidden);
};

const reach = (edges: readonly SceneEdge[], start: string, forward: boolean): Set<string> => {
  const step = (frontier: readonly string[], seen: Set<string>): Set<string> => {
    const next = edges.filter((edge) => frontier.includes(forward ? edge.source : edge.target) && !seen.has(edge.id));
    if (next.length === 0) return seen;
    const nodes = next.map((edge) => (forward ? edge.target : edge.source)).filter((id) => !seen.has(id));
    return step(nodes, new Set([...seen, ...next.map((edge) => edge.id), ...nodes]));
  };
  return step([start], new Set());
};

/** Everything that can lead to the selection and everything it can lead to. */
export const pathLook = (scene: Scene, focus: string | null): Look => {
  if (focus === null) return plainLook;
  const edge = scene.edges.find((candidate) => candidate.id === focus);
  if (!edge && !scene.nodes.some((node) => node.id === focus)) return plainLook;
  const along = edge
    ? new Set([edge.id, edge.source, edge.target, ...reach(scene.edges, edge.source, false), ...reach(scene.edges, edge.target, true)])
    : new Set([focus, ...reach(scene.edges, focus, false), ...reach(scene.edges, focus, true)]);
  return { ...plainLook, dim: dimExcept(scene, along), path: along };
};

export type AllFilesOptions = { focus: boolean; cyclesOnly: boolean };

const isFile = (id: string) => id.startsWith("module:");
const isFileEdge = (edge: SceneEdge) => edge.id.startsWith("imports:");
const isGroupEdge = (edge: SceneEdge) => edge.id.startsWith("folders:");

/**
 * The "All files" view: folder arrows by default, file arrows only around the selection,
 * optionally narrowed to files in cycles or to the selection's neighbours.
 */
export const allFilesLook = (scene: Scene, selected: string | null, options: AllFilesOptions): Look => {
  const nodeIds = new Set(scene.nodes.map((node) => node.id));
  const edgeById = new Map(scene.edges.map((edge) => [edge.id, edge]));
  const valid = selected !== null && (nodeIds.has(selected) || edgeById.has(selected)) ? selected : null;
  const files = scene.nodes.filter((node) => isFile(node.id));
  const filesIn = (group: string) => files.filter((file) => file.parent === group).map((file) => file.id);
  const fileEdges = scene.edges.filter(isFileEdge);
  const groupEdges = scene.edges.filter(isGroupEdge);
  const fileNeighbours = (ids: readonly string[]) =>
    fileEdges.filter((edge) => ids.includes(edge.source) || ids.includes(edge.target)).flatMap((edge) => [edge.source, edge.target]);

  const focusSet = (id: string): string[] => {
    if (isFile(id)) return [id, ...fileNeighbours([id])];
    if (id.startsWith("group:")) return [...filesIn(id), ...fileNeighbours(filesIn(id))];
    const edge = edgeById.get(id) as SceneEdge;
    return isGroupEdge(edge) ? [...filesIn(edge.source), ...filesIn(edge.target)] : [edge.source, edge.target];
  };

  const focused = options.focus && valid !== null;
  const filtered = options.cyclesOnly || focused;
  const visibleFiles = new Set(
    focused && valid
      ? focusSet(valid)
      : options.cyclesOnly
        ? files.filter((file) => file.data.kind === "dot" && file.data.cyclic).map((file) => file.id)
        : files.map((file) => file.id),
  );
  const hiddenFiles = filtered ? files.filter((file) => !visibleFiles.has(file.id)).map((file) => file.id) : [];
  const groups = scene.nodes.filter((node) => node.id.startsWith("group:"));
  const hiddenGroups = filtered ? groups.filter((group) => filesIn(group.id).every((id) => !visibleFiles.has(id))).map((group) => group.id) : [];
  const lanes = scene.nodes.filter((node) => node.id.startsWith("lane:"));
  const hiddenLanes = filtered
    ? lanes.filter((lane) => groups.filter((group) => group.parent === lane.id).every((group) => hiddenGroups.includes(group.id))).map((lane) => lane.id)
    : [];
  const hiddenNodes = new Set([...hiddenFiles, ...hiddenGroups, ...hiddenLanes]);
  const hiddenEdges = new Set(
    filtered
      ? [
          ...groupEdges.map((edge) => edge.id),
          ...fileEdges.filter((edge) => hiddenNodes.has(edge.source) || hiddenNodes.has(edge.target)).map((edge) => edge.id),
        ]
      : fileEdges.map((edge) => edge.id),
  );

  if (valid === null) return { ...plainLook, hidden: new Set([...hiddenNodes, ...hiddenEdges]) };

  const dimFilesExcept = (keep: ReadonlySet<string>) => files.filter((file) => !keep.has(file.id)).map((file) => file.id);
  const highlight = (() => {
    if (isFile(valid)) {
      const outgoing = fileEdges.filter((edge) => edge.source === valid);
      const incoming = fileEdges.filter((edge) => edge.target === valid);
      return {
        shown: [...outgoing, ...incoming].map((edge) => edge.id),
        outgoing: outgoing.map((edge) => edge.id),
        incoming: incoming.map((edge) => edge.id),
        dim: [
          ...dimFilesExcept(new Set([valid, ...outgoing.map((edge) => edge.target), ...incoming.map((edge) => edge.source)])),
          ...groupEdges.map((edge) => edge.id),
        ],
      };
    }
    if (valid.startsWith("group:")) {
      const touching = groupEdges.filter((edge) => edge.source === valid || edge.target === valid);
      return {
        shown: [],
        outgoing: touching.filter((edge) => edge.source === valid).map((edge) => edge.id),
        incoming: touching.filter((edge) => edge.target === valid).map((edge) => edge.id),
        dim: [
          ...groupEdges.filter((edge) => !touching.includes(edge)).map((edge) => edge.id),
          ...dimFilesExcept(new Set(filesIn(valid))),
        ],
      };
    }
    const edge = edgeById.get(valid) as SceneEdge;
    const ends = isGroupEdge(edge) ? [...filesIn(edge.source), ...filesIn(edge.target)] : [edge.source, edge.target];
    return {
      shown: [edge.id],
      outgoing: [edge.id],
      incoming: [],
      dim: [...dimFilesExcept(new Set(ends)), ...groupEdges.filter((other) => other.id !== edge.id).map((other) => other.id)],
    };
  })();
  const shown = new Set(highlight.shown);
  return {
    ...plainLook,
    hidden: new Set([...hiddenNodes, ...[...hiddenEdges].filter((id) => !shown.has(id))]),
    dim: new Set(highlight.dim),
    outgoing: new Set(highlight.outgoing),
    incoming: new Set(highlight.incoming),
  };
};
