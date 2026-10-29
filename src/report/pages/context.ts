import { type Result, type Side, err, ok } from "../../model";
import { type Tree, ancestry, partNames } from "../../scan/parts";
import type { Facts, Layers } from "../facts";
import { bullets, code, factLines, plural } from "../markdown";
import { edgeText, severityText, shareText } from "./text";

export type PageOptions = { exportedAt: string; scope?: string; logic: boolean };

export type Add = (path: string, content: string) => void;

export const pageContext = (facts: Facts, tree: Tree, options: PageOptions, add: Add) => {
  const scopeNode = options.scope === undefined ? undefined : tree.nodes.get(options.scope);

  const included = scopeNode ? new Set(scopeNode.moduleIds) : null;
  const modules = included ? facts.moduleList.filter((module) => included.has(module.id)) : facts.moduleList;
  const includedPaths = new Set(modules.map((module) => module.path));
  const touches = (paths: readonly string[]) => paths.some((path) => includedPaths.has(path));
  const names = partNames(tree);

  const laneLabel = new Map(facts.sides.map((info) => [info.side, info.label]));
  const sideLabel = (side: Side) => laneLabel.get(side) ?? side;
  const node = (id: string) => tree.nodes.get(id);
  const inPart = (id: string) => !scopeNode || ancestry(tree, id).includes(scopeNode.id);
  const pageOf = (id: string) => {
    const found = node(id);
    const name = names.get(id) ?? "";

    if (!found || found.kind === "root") return "_index.md";

    return found.children.length > 0 ? `${name}/_index.md` : `${name}.md`;
  };
  const trail = (id: string) =>
    ancestry(tree, id)
      .slice(1)
      .flatMap((step) => node(step)?.label ?? [])
      .join(" › ");
  const partOf = (moduleId: string) => tree.pathOf.get(moduleId)?.at(-1);
  const partRef = (id: string) =>
    inPart(id) ? `${code(pageOf(id))} (${trail(id)})` : `${trail(id)} (not in this export)`;
  const filePageOf = (path: string) => {
    const part = partOf(path);
    return part !== undefined && inPart(part) ? code(pageOf(part)) : "not in this export";
  };
  const areaName = (id: string) => code(facts.areaLabelOf(id));
  const areaPage = (id: string) => {
    const found = [...tree.nodes.values()].find((candidate) => candidate.area?.id === id);
    return found ? partRef(found.id) : "no page";
  };

  const cyclesTouching = (moduleIds: readonly string[], noun: string) => {
    const inside = new Set(moduleIds.flatMap((id) => facts.modules.get(id)?.path ?? []));

    return bullets(
      facts.cycles
        .filter((cycle) => cycle.files.some((file) => inside.has(file)))
        .map((cycle) => {
          const here = cycle.files.filter((file) => inside.has(file)).length;
          const where =
            here === cycle.files.length ? `all in this ${noun}` : `${here} of ${cycle.files.length} in this ${noun}`;
          return `Cycle #${cycle.number} (${where}), ${severityText(cycle)}: ${cycle.files.map(code).join(", ")}`;
        }),
    );
  };

  const packageLines = (moduleIds: readonly string[]) =>
    bullets(facts.packages(moduleIds).map((entry) => `${code(entry.name)}: ${plural(entry.files, "file")}`));

  const layerLines = (layers: Layers, limit: number) =>
    [
      factLines([
        ["Layer order", layers.order.map(areaName).join(", ")],
        [
          "Imports pointing back",
          shareText(layers.back.length, layers.between, "import between areas", "imports between areas"),
        ],
        ["Search", layers.approximate ? "heuristic, may not be the fewest" : "exact"],
      ]),
      ...(layers.back.length === 0
        ? []
        : [
            `${bullets(layers.back.slice(0, limit).map(edgeText))}${
              layers.back.length > limit ? `\n- And ${layers.back.length - limit} more in \`_areas.md\`.` : ""
            }`,
          ]),
    ].join("\n\n");
  const cycles = facts.cycles.filter((cycle) => touches(cycle.files));
  const scopeSides = new Set(modules.map((module) => module.placement.side));
  const scopeAreas = new Set(modules.flatMap((module) => (module.areaId === null ? [] : [module.areaId])));
  const touchesArea = (...ids: readonly string[]) => ids.some((id) => scopeAreas.has(id));
  const layerSides = facts.layers.filter((layers) => scopeSides.has(layers.side));
  const kit = facts.project.framework !== null;

  return {
    facts,
    tree,
    options,
    add,
    kit,
    scopeNode,
    modules,
    includedPaths,
    touches,
    names,
    sideLabel,
    node,
    inPart,
    pageOf,
    trail,
    partOf,
    partRef,
    filePageOf,
    areaName,
    areaPage,
    cyclesTouching,
    packageLines,
    layerLines,
    cycles,
    scopeSides,
    scopeAreas,
    touchesArea,
    layerSides,
  };
};

export type Context = ReturnType<typeof pageContext>;

export const checkScope = (tree: Tree, options: PageOptions): Result<null> =>
  options.scope !== undefined && !tree.nodes.has(options.scope) ? err(`Unknown part: ${options.scope}`) : ok(null);
