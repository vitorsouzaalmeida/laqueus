import { type Area, type DependencyEdge, type Side, modulePath } from "./model";

type WeightedEdge = readonly [number, number, number];

const folderWeight = 1;
const largestAffineFolder = 200;
const minimumLabelShare = 0.25;
export const farOut = 3;
export const widelyUsedShare = 0.1;

const directoryOf = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "." : path.slice(0, slash);
};

/** Reads a slot of a dense array; every index used here comes from the length of that same array. */
const at = <T>(items: readonly T[], index: number): T => {
  const item = items[index];

  if (item === undefined) throw new RangeError(`No item at index ${index}`);

  return item;
};

const quantile = (sorted: readonly number[], share: number) => {
  const rank = (sorted.length - 1) * share;
  const low = Math.floor(rank);
  const high = Math.min(low + 1, sorted.length - 1);

  return at(sorted, low) + (rank - low) * (at(sorted, high) - at(sorted, low));
};

const widelyUsed = (ids: readonly string[], edges: readonly DependencyEdge[]): Set<string> => {
  const inSide = new Set(ids);
  const importers = edges
    .filter((edge) => edge.from !== edge.to && inSide.has(edge.from) && inSide.has(edge.to))
    .reduce(
      (map, edge) => map.set(edge.to, (map.get(edge.to) ?? new Set<string>()).add(edge.from)),
      new Map<string, Set<string>>(),
    );
  const fanIn = (id: string) => importers.get(id)?.size ?? 0;
  const sorted = ids.map(fanIn).toSorted((a, b) => a - b);
  const lower = quantile(sorted, 0.25);
  const upper = quantile(sorted, 0.75);
  const fence = upper + farOut * Math.max(upper - lower, 1);

  return new Set(ids.filter((id) => fanIn(id) > fence && fanIn(id) >= widelyUsedShare * ids.length));
};

const normalise = (communities: readonly number[]): number[] => {
  const order = new Map<number, number>();
  return communities.map((community) => {
    const known = order.get(community);

    if (known !== undefined) return known;

    order.set(community, order.size);

    return order.size - 1;
  });
};

export const modularityPass = (size: number, edges: readonly WeightedEdge[]): number[] => {
  const neighbours = Array.from({ length: size }, () => new Map<number, number>());

  edges.forEach(([a, b, weight]) => {
    const ofA = at(neighbours, a);
    const ofB = at(neighbours, b);

    ofA.set(b, (ofA.get(b) ?? 0) + weight);
    if (a !== b) ofB.set(a, (ofB.get(a) ?? 0) + weight);
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
      const current = at(community, node);
      communityDegree[current] = at(communityDegree, current) - nodeDegree;

      const links = [...at(neighbours, node)]
        .filter(([other]) => other !== node)
        .reduce((map, [other, weight]) => {
          const target = at(community, other);
          return map.set(target, (map.get(target) ?? 0) + weight);
        }, new Map<number, number>());
      const gain = (target: number) => (links.get(target) ?? 0) - (at(communityDegree, target) * nodeDegree) / total;
      const best = [...links.keys()]
        .toSorted((a, b) => a - b)
        .reduce((chosen, candidate) => (gain(candidate) > gain(chosen) + 1e-12 ? candidate : chosen), current);

      community[node] = best;
      communityDegree[best] = at(communityDegree, best) + nodeDegree;

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
      const from = Math.min(at(communities, a), at(communities, b));
      const to = Math.max(at(communities, a), at(communities, b));
      const key = `${from},${to}`;

      return map.set(key, [from, to, (map.get(key)?.[2] ?? 0) + weight]);
    }, new Map<string, WeightedEdge>())
    .values(),
];

const affinityEdges = (ids: readonly string[]): WeightedEdge[] => {
  const byFolder = ids.reduce(
    (map, id, node) => map.set(directoryOf(modulePath(id)), [...(map.get(directoryOf(modulePath(id))) ?? []), node]),
    new Map<string, number[]>(),
  );
  return [...byFolder.values()]
    .filter((members) => members.length > 1 && members.length <= largestAffineFolder)
    .flatMap((members) =>
      members.flatMap((a, position) =>
        members.slice(position + 1).map((b) => [a, b, folderWeight / (members.length - 1)] as const),
      ),
    );
};

const tokensOf = (id: string) =>
  new Set(
    modulePath(id)
      .split("/")
      .slice(0, -1)
      .filter((token) => !/^\[.*\]$/.test(token)),
  );

const ancestorsOf = (id: string) => {
  const segments = modulePath(id).split("/").slice(0, -1);
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
      .toSorted((a, b) => b.score - a.score || a.token.localeCompare(b.token))
      .slice(0, 2)
      .map((candidate) => candidate.token)
      .join(" / ");
  };

  return (members: readonly string[]): string => {
    const dominant = [...countUnder(members)]
      .filter(([directory, count]) => count >= members.length * 0.5 && !isGenericRoot(directory))
      .toSorted(([a, countA], [b, countB]) => b.split("/").length - a.split("/").length || countB - countA)[0];

    if (dominant) return shortDirectory(dominant[0]);

    const tokens = byTokens(members);

    if (tokens !== "") return tokens;

    const first = members[0];

    return first ? shortDirectory(directoryOf(modulePath(first))) : "files";
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

type Group = { members: string[]; parent: number | null };

const groupsOf = (assignment: readonly number[]) =>
  assignment.reduce(
    (map, community, node) => map.set(community, [...(map.get(community) ?? []), node]),
    new Map<number, number[]>(),
  );

export const detectAreas = (moduleIds: readonly string[], edges: readonly DependencyEdge[], side: Side): Area[] => {
  const all = moduleIds.toSorted();

  if (all.length === 0) return [];

  const aside = widelyUsed(all, edges);
  const ids = all.filter((id) => !aside.has(id));
  const inSide = new Set(all);
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

  const idOf = (node: number) => at(ids, node);
  const isStandalone = (nodes: readonly number[]) => nodes.length === 1 && nodes.every((node) => !connected.has(node));
  const fine = [...groupsOf(firstLevel).values()].filter((nodes) => !isStandalone(nodes));
  const standalone = [...groupsOf(firstLevel).values()].filter(isStandalone).flat();
  const coarseOf = (nodes: readonly number[]) => at(secondLevelOfFirst, at(firstLevel, at(nodes, 0)));
  const coarseCount = new Set(fine.map(coarseOf)).size;
  const twoLevels = coarseCount > 1 && coarseCount < fine.length;

  const coarse: Group[] = twoLevels
    ? [...new Set(fine.map(coarseOf))].map((community) => ({
        members: fine
          .filter((nodes) => coarseOf(nodes) === community)
          .flat()
          .map(idOf),
        parent: null,
      }))
    : fine.map((nodes) => ({ members: nodes.map(idOf), parent: null }));
  const children: Group[] = twoLevels
    ? fine.map((nodes) => ({
        members: nodes.map(idOf),
        parent: [...new Set(fine.map(coarseOf))].indexOf(coarseOf(nodes)),
      }))
    : [];

  const label = labeller(
    fine.map((nodes) => nodes.map(idOf)),
    all,
  );
  const bySize = (a: Group, b: Group) => b.members.length - a.members.length;
  const coarseSorted = coarse.toSorted(bySize);
  const coarseLabels = uniqueLabels(coarseSorted.map((group) => label(group.members)));
  const coarseIds = coarseLabels.map((value) => `area:${side}:${slug(value)}`);
  const uniqueIds = uniqueLabels(coarseIds).map((value) => value.replace(/ \((\d+)\)$/, "-$1"));

  const internal = (members: readonly string[]) => {
    const set = new Set(members);
    return edges.reduce(
      (counts, edge) => {
        const from = set.has(edge.from);
        const to = set.has(edge.to);
        const between = inSide.has(edge.from) && inSide.has(edge.to) && edge.from !== edge.to;

        return between && (from || to)
          ? { inside: counts.inside + (from && to ? 1 : 0), touching: counts.touching + 1 }
          : counts;
      },
      { inside: 0, touching: 0 },
    );
  };

  const toArea = (group: Group, id: string, areaLabel: string, parent: string | null): Area => {
    const counts = internal(group.members);
    return {
      id,
      side,
      label: areaLabel,
      parent,
      moduleIds: group.members.toSorted(),
      internalImports: counts.inside,
      touchingImports: counts.touching,
    };
  };

  const topAreas = coarseSorted.map((group, index) =>
    toArea(group, at(uniqueIds, index), at(coarseLabels, index), null),
  );
  const subAreas = coarseSorted.flatMap((group, index) => {
    const original = coarse.indexOf(group);
    const own = children.filter((child) => child.parent === original).toSorted(bySize);

    if (own.length < 2) return [];

    const labels = uniqueLabels(own.map((child) => label(child.members)));

    return own.map((child, childIndex) =>
      toArea(
        child,
        `${at(uniqueIds, index)}/${slug(at(labels, childIndex))}-${childIndex + 1}`,
        at(labels, childIndex),
        at(uniqueIds, index),
      ),
    );
  });
  const standaloneArea =
    standalone.length === 0
      ? []
      : [toArea({ members: standalone.map(idOf), parent: null }, `area:${side}:standalone`, "Standalone files", null)];

  const widelyUsedArea =
    aside.size === 0
      ? []
      : [toArea({ members: [...aside], parent: null }, `area:${side}:widely-used`, "Widely used files", null)];

  return [...topAreas, ...widelyUsedArea, ...standaloneArea, ...subAreas];
};

export const modularity = (groupOf: ReadonlyMap<string, string>, edges: readonly DependencyEdge[]): number | null => {
  const links = edges.flatMap((edge) => {
    const from = groupOf.get(edge.from);
    const to = groupOf.get(edge.to);

    return edge.from === edge.to || from === undefined || to === undefined ? [] : [[from, to] as const];
  });

  if (links.length === 0) return null;

  const degree = links.reduce(
    (map, [from, to]) => map.set(from, (map.get(from) ?? 0) + 1).set(to, (map.get(to) ?? 0) + 1),
    new Map<string, number>(),
  );
  const inside = links.filter(([from, to]) => from === to).length;
  const expected = [...degree.values()].reduce((sum, value) => sum + (value / (2 * links.length)) ** 2, 0);

  return Math.round((inside / links.length - expected) * 100) / 100;
};
