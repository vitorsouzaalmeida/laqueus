import type { Area, DependencyEdge } from "./model";

type WeightedEdge = readonly [number, number, number];

const folderAffinity = 0.3;
const largestAffineFolder = 40;
const minimumLabelShare = 0.25;

const directoryOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
};

const pathOf = (id: string) => id.slice("module:".length);

const normalise = (communities: readonly number[]): number[] => {
  const order = new Map<number, number>();
  return communities.map((community) => {
    if (!order.has(community)) order.set(community, order.size);
    return order.get(community) as number;
  });
};

export const modularityPass = (size: number, edges: readonly WeightedEdge[]): number[] => {
  const neighbours = Array.from({ length: size }, () => new Map<number, number>());
  edges.forEach(([a, b, weight]) => {
    neighbours[a]?.set(b, (neighbours[a]?.get(b) ?? 0) + weight);
    if (a !== b) neighbours[b]?.set(a, (neighbours[b]?.get(a) ?? 0) + weight);
  });
  const degree = neighbours.map((links, node) =>
    [...links].reduce((sum, [other, weight]) => sum + (other === node ? 2 * weight : weight), 0),
  );
  const total = degree.reduce((sum, value) => sum + value, 0);
  if (total === 0) return Array.from({ length: size }, (_, node) => node);
  const community = Array.from({ length: size }, (_, node) => node);
  const communityDegree = [...degree];

  const improve = (round: number): void => {
    const moved = degree.reduce((changed, nodeDegree, node) => {
      const current = community[node] as number;
      communityDegree[current] = (communityDegree[current] as number) - nodeDegree;
      const links = [...(neighbours[node] ?? [])]
        .filter(([other]) => other !== node)
        .reduce(
          (map, [other, weight]) =>
            map.set(community[other] as number, (map.get(community[other] as number) ?? 0) + weight),
          new Map<number, number>(),
        );
      const gain = (target: number) =>
        (links.get(target) ?? 0) - ((communityDegree[target] as number) * nodeDegree) / total;
      const best = [...links.keys()]
        .sort((a, b) => a - b)
        .reduce((chosen, candidate) => (gain(candidate) > gain(chosen) + 1e-12 ? candidate : chosen), current);
      community[node] = best;
      communityDegree[best] = (communityDegree[best] as number) + nodeDegree;
      return changed || best !== current;
    }, false);
    if (moved && round < 50) improve(round + 1);
  };
  improve(0);
  return normalise(community);
};

const aggregate = (communities: readonly number[], edges: readonly WeightedEdge[]): WeightedEdge[] => [
  ...edges
    .reduce((map, [a, b, weight]) => {
      const from = communities[a] as number;
      const to = communities[b] as number;
      const key = from <= to ? `${from},${to}` : `${to},${from}`;
      return map.set(key, (map.get(key) ?? 0) + weight);
    }, new Map<string, number>())
    .entries(),
].map(([key, weight]) => {
  const [from, to] = key.split(",").map(Number) as [number, number];
  return [from, to, weight] as const;
});

const affinityEdges = (ids: readonly string[]): WeightedEdge[] => {
  const byFolder = ids.reduce(
    (map, id, node) => map.set(directoryOf(pathOf(id)), [...(map.get(directoryOf(pathOf(id))) ?? []), node]),
    new Map<string, number[]>(),
  );
  return [...byFolder.values()]
    .filter((members) => members.length > 1 && members.length <= largestAffineFolder)
    .flatMap((members) =>
      members.flatMap((a, position) => members.slice(position + 1).map((b) => [a, b, folderAffinity] as const)),
    );
};

const tokensOf = (id: string) =>
  new Set(
    pathOf(id)
      .split("/")
      .slice(0, -1)
      .filter((token) => !/^\[.*\]$/.test(token)),
  );

const ancestorsOf = (id: string) => {
  const segments = pathOf(id).split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
};

const countUnder = (ids: readonly string[]) =>
  ids.reduce((map, id) => {
    ancestorsOf(id).forEach((directory) => map.set(directory, (map.get(directory) ?? 0) + 1));
    return map;
  }, new Map<string, number>());

const shortDirectory = (directory: string) => directory.split("/").slice(-2).join("/");

const labeller = (groups: readonly (readonly string[])[], allIds: readonly string[]) => {
  const projectCounts = countUnder(allIds);
  const isGenericRoot = (directory: string) => (projectCounts.get(directory) ?? 0) >= allIds.length * 0.5;
  const documentFrequency = groups.reduce((map, members) => {
    new Set(members.flatMap((id) => [...tokensOf(id)])).forEach((token) => map.set(token, (map.get(token) ?? 0) + 1));
    return map;
  }, new Map<string, number>());
  const byTokens = (members: readonly string[]) => {
    const counts = members.reduce((map, id) => {
      tokensOf(id).forEach((token) => map.set(token, (map.get(token) ?? 0) + 1));
      return map;
    }, new Map<string, number>());
    return [...counts]
      .filter(([, count]) => count / members.length >= minimumLabelShare)
      .map(([token, count]) => ({
        token,
        score: (count / members.length) * Math.log((groups.length + 1) / (documentFrequency.get(token) ?? 1)),
      }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.token.localeCompare(b.token))
      .slice(0, 2)
      .map((candidate) => candidate.token)
      .join(" / ");
  };
  return (members: readonly string[]): string => {
    const dominant = [...countUnder(members)]
      .filter(([directory, count]) => count >= members.length * 0.5 && !isGenericRoot(directory))
      .sort(([a, countA], [b, countB]) => b.split("/").length - a.split("/").length || countB - countA)[0];
    if (dominant) return shortDirectory(dominant[0]);
    const tokens = byTokens(members);
    if (tokens !== "") return tokens;
    const first = members[0];
    return first ? shortDirectory(directoryOf(pathOf(first))) : "files";
  };
};

const slug = (label: string) =>
  label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "area";

const uniqueLabels = (labels: readonly string[]): string[] =>
  labels.map((label, position) => {
    const before = labels.slice(0, position).filter((other) => other === label).length;
    return before === 0 ? label : `${label} (${before + 1})`;
  });

type Grouping = { members: string[]; parent: number | null };

export const detectAreas = (moduleIds: readonly string[], edges: readonly DependencyEdge[]): Area[] => {
  const ids = [...moduleIds].sort();
  if (ids.length === 0) return [];
  const position = new Map(ids.map((id, node) => [id, node]));
  const importEdges = edges.flatMap((edge) => {
    const a = position.get(edge.from);
    const b = position.get(edge.to);
    return a === undefined || b === undefined || a === b ? [] : [[a, b, 1] as const];
  });
  const connected = new Set(importEdges.flatMap(([a, b]) => [a, b]));
  const firstLevel = modularityPass(ids.length, [...importEdges, ...affinityEdges(ids)]);
  const secondLevelOfFirst = modularityPass(
    Math.max(...firstLevel) + 1,
    aggregate(firstLevel, [...importEdges, ...affinityEdges(ids)]),
  );

  const groupsOf = (assignment: readonly number[]) =>
    assignment.reduce((map, community, node) => map.set(community, [...(map.get(community) ?? []), node]), new Map<number, number[]>());

  const isStandalone = (nodes: readonly number[]) => nodes.length === 1 && !connected.has(nodes[0] as number);
  const fine = [...groupsOf(firstLevel).values()].filter((nodes) => !isStandalone(nodes));
  const standalone = [...groupsOf(firstLevel).values()].filter(isStandalone).flat();
  const coarseOf = (nodes: readonly number[]) => secondLevelOfFirst[firstLevel[nodes[0] as number] as number] as number;
  const coarseCount = new Set(fine.map(coarseOf)).size;
  const twoLevels = coarseCount > 1 && coarseCount < fine.length;

  const coarse: Grouping[] = twoLevels
    ? [...new Set(fine.map(coarseOf))].map((community) => ({
        members: fine.filter((nodes) => coarseOf(nodes) === community).flat().map((node) => ids[node] as string),
        parent: null,
      }))
    : fine.map((nodes) => ({ members: nodes.map((node) => ids[node] as string), parent: null }));
  const children: Grouping[] = twoLevels
    ? fine.map((nodes) => ({
        members: nodes.map((node) => ids[node] as string),
        parent: [...new Set(fine.map(coarseOf))].indexOf(coarseOf(nodes)),
      }))
    : [];

  const label = labeller(fine.map((nodes) => nodes.map((node) => ids[node] as string)), ids);
  const bySize = (a: Grouping, b: Grouping) => b.members.length - a.members.length;
  const coarseSorted = [...coarse].sort(bySize);
  const coarseLabels = uniqueLabels(coarseSorted.map((group) => label(group.members)));
  const coarseIds = coarseLabels.map((value) => `area:${slug(value)}`);
  const uniqueIds = uniqueLabels(coarseIds).map((value) => value.replace(/ \((\d+)\)$/, "-$1"));
  const internal = (members: readonly string[]) => {
    const set = new Set(members);
    return edges.reduce(
      (counts, edge) => {
        const from = set.has(edge.from);
        const to = set.has(edge.to);
        return from || to
          ? { inside: counts.inside + (from && to ? 1 : 0), touching: counts.touching + 1 }
          : counts;
      },
      { inside: 0, touching: 0 },
    );
  };
  const toArea = (group: Grouping, id: string, areaLabel: string, parent: string | null): Area => {
    const counts = internal(group.members);
    return {
      id,
      label: areaLabel,
      parent,
      moduleIds: [...group.members].sort(),
      internalImports: counts.inside,
      touchingImports: counts.touching,
    };
  };

  const topAreas = coarseSorted.map((group, index) =>
    toArea(group, uniqueIds[index] as string, coarseLabels[index] as string, null),
  );
  const subAreas = coarseSorted.flatMap((group, index) => {
    const original = coarse.indexOf(group);
    const own = children.filter((child) => child.parent === original).sort(bySize);
    if (own.length < 2) return [];
    const labels = uniqueLabels(own.map((child) => label(child.members)));
    return own.map((child, childIndex) =>
      toArea(child, `${uniqueIds[index]}/${slug(labels[childIndex] as string)}-${childIndex + 1}`, labels[childIndex] as string, uniqueIds[index] as string),
    );
  });
  const standaloneArea =
    standalone.length === 0
      ? []
      : [toArea({ members: standalone.map((node) => ids[node] as string), parent: null }, "area:standalone", "Standalone files", null)];
  return [...topAreas, ...standaloneArea, ...subAreas];
};
