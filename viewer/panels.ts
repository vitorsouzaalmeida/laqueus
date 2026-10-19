import type {
  CallEdge,
  DependencyEdge,
  Diagnostic,
  FunctionLogic,
  FunctionNode,
  LogicNode,
  LogicOutlineItem,
  GraphSnapshot,
  Location,
  ModuleNode,
  Route,
} from "../src/model";
import { type Child, basename, formatCC, groupBy, h, plural } from "./dom";
import { type Index, externalCounts, fullRef, lineRef, routeLabel } from "./data";
import type { MapItem, MapLink, MapView, RouteView, Tree, TreeNode } from "./map";

export type PanelContext = {
  data: GraphSnapshot;
  index: Index;
  tree: Tree;
  pathPickerFrom: string | null;
  open: {
    module: (moduleId: string) => void;
    mapNode: (nodeId: string, selected?: string | null) => void;
    mapItem: (itemId: string) => void;
    functions: (moduleId: string, functionId?: string | null) => void;
    fn: (functionId: string) => void;
    logic: (functionId: string) => void;
    route: (routeId: string | null) => void;
    routeItem: (itemId: string | null) => void;
    path: (from: string, to: string) => void;
    pathPicker: (from: string | null) => void;
  };
  copy: (text: string) => void;
};

const metric = (name: string, value: string | number, extraClass = "") =>
  h("div", { class: `metric ${extraClass}` }, h("span", { class: "value" }, String(value)), h("span", { class: "name" }, name));

const section = (title: string, ...content: HTMLElement[]) => [h("h3", {}, title), ...content];

const list = (items: readonly HTMLElement[], emptyText: string) =>
  items.length === 0 ? h("p", { class: "note" }, emptyText) : h("ul", { class: "list" }, ...items);

const link = (label: string, onClick: () => void, title?: string) => h("button", { class: "link", title, onClick }, label);

const moduleLink = (ctx: PanelContext, moduleId: string, label?: string) => {
  const module = ctx.index.modules.get(moduleId);
  return link(label ?? module?.path ?? moduleId, () => ctx.open.module(moduleId), module?.path);
};

const sideBadge = (ctx: PanelContext, side: string | null) =>
  side ? h("span", { class: `lane-badge side-${side}` }, ctx.index.lanes.get(side)?.label ?? side) : null;

const occurrenceLines = (occurrences: readonly Location[]) =>
  `line ${occurrences.map((location) => location.line).join(", ")}`;

const limitList = (items: readonly HTMLElement[], limit: number, emptyText: string) =>
  items.length <= limit
    ? list(items, emptyText)
    : h(
        "div",
        {},
        list(items.slice(0, limit), emptyText),
        h("details", {}, h("summary", { class: "note" }, `Show ${items.length - limit} more`), list(items.slice(limit), "")),
      );

const packagesSection = (modules: readonly ModuleNode[]) => {
  const counts = externalCounts(modules);
  return section(
    `Packages used (${counts.length})`,
    counts.length === 0
      ? h("p", { class: "note" }, "No external packages imported.")
      : h(
          "div",
          { class: "chips" },
          ...counts.slice(0, 24).map(([name, count]) => h("span", { class: "chip", title: `${plural(count, "file")} import it` }, `${name} · ${count}`)),
        ),
  );
};

const diagnosticItems = (diagnostics: readonly Diagnostic[]) =>
  diagnostics.map((diagnostic) =>
    h(
      "li",
      {},
      h("span", {}, h("span", { class: "diagnostic-kind" }, diagnostic.kind), " ", diagnostic.message),
      h("span", { class: "aside" }, diagnostic.line ? `line ${diagnostic.line}` : ""),
    ),
  );

const rankedFunctions = (functions: readonly FunctionNode[]) =>
  [...functions].sort((a, b) => b.complexity - a.complexity || a.location.line - b.location.line);

const functionRankItems = (ctx: PanelContext, functions: readonly FunctionNode[], showFile: boolean) =>
  rankedFunctions(functions).map((fn) =>
    h(
      "li",
      {},
      h(
        "span",
        {},
        link(fn.name, () => ctx.open.functions(fn.moduleId, fn.id)),
        showFile ? h("div", { class: "note mono" }, lineRef(fn.location)) : null,
      ),
      h("span", { class: "badge", title: "Cyclomatic complexity" }, fn.complexity),
    ),
  );

const fileItems = (ctx: PanelContext, moduleIds: readonly string[]) =>
  moduleIds
    .flatMap((id) => ctx.index.modules.get(id) ?? [])
    .sort((a, b) => Number(b.placement.entry !== null) - Number(a.placement.entry !== null) || a.depth - b.depth || a.path.localeCompare(b.path))
    .map((module) =>
      h(
        "li",
        {},
        h("span", {}, module.placement.entry ? "◆ " : "", moduleLink(ctx, module.id)),
        h("span", { class: "aside" }, `CC ${formatCC(module.metrics.maxCC)}`),
      ),
    );

export const overviewPanel = (ctx: PanelContext): HTMLElement[] => {
  const data = ctx.data;
  const cycles = [...ctx.index.cycles.entries()].sort(([a], [b]) => a - b);
  const sides = (ctx.tree.nodes.get("root")?.children ?? []).flatMap((id) => ctx.tree.nodes.get(id) ?? []);
  const mostImported = [...data.modules]
    .filter((module) => module.metrics.fanIn > 0)
    .sort((a, b) => b.metrics.fanIn - a.metrics.fanIn)
    .slice(0, 10);
  const entryGroups = [...groupBy(data.modules.filter((module) => module.placement.entry !== null), (module) => module.placement.entry as string)].sort(([a], [b]) => a.localeCompare(b));
  return [
    h("h2", {}, data.name),
    h("div", { class: "note path mono" }, data.root),
    h(
      "div",
      { class: "metrics" },
      metric("Files", data.modules.length),
      metric("Import edges", data.dependencyEdges.length),
      metric("Cycles", cycles.length, cycles.length > 0 ? "cycle" : ""),
      metric("Areas", data.areas.filter((area) => area.parent === null).length),
      metric("Routes", data.routes.length),
      metric("Warnings", data.diagnostics.length),
    ),
    h(
      "p",
      { class: "note" },
      "Each card is a part of the project. Double-click a card (or select it and press Enter) to open it; Backspace or the breadcrumb goes back up. Hover a card to see what it depends on.",
    ),
    ...section(
      "Sides",
      list(
        sides.map((node) =>
          h(
            "li",
            {},
            h("span", {}, link(node.label, () => ctx.open.mapNode(node.id)), h("div", { class: "note" }, ctx.index.lanes.get(node.side ?? "")?.description ?? "")),
            h("span", { class: "aside" }, plural(node.moduleIds.length, "file")),
          ),
        ),
        "",
      ),
    ),
    ...section(
      "Entry points",
      ...entryGroups.map(([label, modules]) =>
        h(
          "details",
          {},
          h("summary", {}, `${label} (${modules.length})`),
          list(
            [...modules].sort((a, b) => a.path.localeCompare(b.path)).map((module) => h("li", {}, moduleLink(ctx, module.id))),
            "",
          ),
        ),
      ),
    ),
    ...section(
      "Import cycles",
      list(
        cycles.map(([group, modules]) =>
          h(
            "li",
            {},
            h("span", {}, ...modules.flatMap((module, position): Child[] => [position > 0 ? " → " : null, moduleLink(ctx, module.id)])),
            h("span", { class: "aside" }, `#${group + 1}`),
          ),
        ),
        "No import cycles found.",
      ),
    ),
    ...section("Highest complexity functions", list(functionRankItems(ctx, data.functions, true).slice(0, 15), "No functions found.")),
    ...section(
      "Most imported files",
      list(
        mostImported.map((module) => h("li", {}, moduleLink(ctx, module.id), h("span", { class: "aside" }, `in ${module.metrics.fanIn}`))),
        "No file is imported by another.",
      ),
    ),
  ];
};

const neighbourList = (ctx: PanelContext, view: MapView | null, itemId: string, direction: "out" | "in") => {
  const links = (view?.links ?? []).filter((candidate) => (direction === "out" ? candidate.from : candidate.to) === itemId);
  return list(
    [...links]
      .sort((a, b) => b.count - a.count)
      .flatMap((candidate) => {
        const other = view?.items.find((item) => item.id === (direction === "out" ? candidate.to : candidate.from));
        return other
          ? [h("li", {}, link(other.label, () => ctx.open.mapItem(candidate.id)), h("span", { class: "aside" }, plural(candidate.count, "import")))]
          : [];
      }),
    direction === "out" ? "Imports nothing else in this view." : "Nothing else in this view imports it.",
  );
};

const groupingReason = (ctx: PanelContext, node: TreeNode) => {
  if (node.area) {
    const share = node.area.touchingImports === 0 ? 0 : Math.round((100 * node.area.internalImports) / node.area.touchingImports);
    return node.area.id === "area:standalone"
      ? "Files that neither import nor are imported by another file, and have no folder mates."
      : `Grouped because these files mostly import each other: ${node.area.internalImports} of the ${node.area.touchingImports} imports that touch them (${share}%) stay inside. Named after the folder that holds most of them.`;
  }
  if (node.kind === "folder") return "Files in this folder. Small subfolders are merged into their parent.";
  if (node.kind === "side") return ctx.index.lanes.get(node.side ?? "")?.description ?? "";
  return "";
};

export const nodePanel = (ctx: PanelContext, node: TreeNode, item: MapItem | null, view: MapView | null, isCurrent: boolean): HTMLElement[] => {
  const modules = node.moduleIds.flatMap((id) => ctx.index.modules.get(id) ?? []);
  const scores = modules.flatMap((module) => (module.metrics.maxCC === null ? [] : [module.metrics.maxCC]));
  const kindLabel = { root: "Project", side: "Side", area: "Area", subarea: "Sub-area", folder: "Folder" }[node.kind];
  const itemId = item?.id ?? null;
  return [
    h("div", { class: "note" }, item?.kind === "stub" ? `${kindLabel} outside this view` : kindLabel),
    h("h2", {}, node.label),
    sideBadge(ctx, node.side) ?? h("span", {}),
    h("p", { class: "note" }, groupingReason(ctx, node)),
    h(
      "div",
      { class: "metrics" },
      metric("Files", modules.length),
      metric("Entry points", modules.filter((module) => module.placement.entry !== null).length),
      metric("Max CC", scores.length > 0 ? Math.max(...scores) : "N/A"),
    ),
    isCurrent
      ? h("span", {})
      : h("div", { class: "actions" }, h("button", { class: "primary", onClick: () => ctx.open.mapNode(node.id) }, "Open")),
    ...(itemId && view
      ? [
          ...section("Imports from (in this view)", neighbourList(ctx, view, itemId, "out")),
          ...section("Imported by (in this view)", neighbourList(ctx, view, itemId, "in")),
        ]
      : []),
    ...packagesSection(modules),
    ...section(`Files (${modules.length})`, limitList(fileItems(ctx, node.moduleIds), 40, "No files.")),
  ];
};

export const linkPanel = (ctx: PanelContext, mapLink: MapLink, view: MapView): HTMLElement[] => {
  const from = view.items.find((item) => item.id === mapLink.from);
  const to = view.items.find((item) => item.id === mapLink.to);
  const sources = new Set(from?.moduleIds ?? []);
  const targets = new Set(to?.moduleIds ?? []);
  const imports = (from?.moduleIds ?? []).flatMap((id) => (ctx.index.importsFrom.get(id) ?? []).filter((edge) => sources.has(edge.from) && targets.has(edge.to)));
  return [
    h("h2", {}, "Imports"),
    h(
      "p",
      {},
      link(from?.label ?? mapLink.from, () => ctx.open.mapItem(mapLink.from)),
      h("span", { class: "muted" }, " imports "),
      link(to?.label ?? mapLink.to, () => ctx.open.mapItem(mapLink.to)),
    ),
    ...section(
      `File imports (${imports.length})`,
      limitList(
        imports.map((edge) => h("li", {}, h("span", {}, moduleLink(ctx, edge.from), h("span", { class: "muted" }, " → "), moduleLink(ctx, edge.to)))),
        60,
        "",
      ),
    ),
  ];
};

const importList = (ctx: PanelContext, edges: readonly DependencyEdge[], side: "from" | "to") =>
  list(
    [...edges]
      .sort((a, b) => a[side].localeCompare(b[side]))
      .map((edge) => h("li", {}, moduleLink(ctx, edge[side]), h("span", { class: "aside" }, occurrenceLines(edge.occurrences)))),
    side === "to" ? "Imports no local files." : "Not imported by any local file.",
  );

const chainList = (ctx: PanelContext, chain: readonly string[]) =>
  h("ol", { class: "chain" }, ...chain.map((id) => h("li", {}, moduleLink(ctx, id))));

const pathPicker = (ctx: PanelContext, from: string) => {
  const input = h("input", { type: "search", class: "picker-input", placeholder: "Type a file name", autocomplete: "off", "aria-label": "Target file" }) as HTMLInputElement;
  const results = h("ul", { class: "list" });
  const update = () => {
    const needle = input.value.trim().toLowerCase();
    const hits = needle
      ? ctx.data.modules
          .filter((module) => module.id !== from && module.path.toLowerCase().includes(needle))
          .sort((a, b) => a.path.length - b.path.length)
          .slice(0, 10)
      : [];
    results.replaceChildren(...hits.map((module) => h("li", {}, link(module.path, () => ctx.open.path(from, module.id)))));
  };
  input.addEventListener("input", update);
  setTimeout(() => input.focus(), 0);
  return h(
    "div",
    { class: "picker" },
    h("div", { class: "note" }, "Show the shortest import chain from this file to:"),
    input,
    results,
    link("Cancel", () => ctx.open.pathPicker(null)),
  );
};

const areaTrail = (ctx: PanelContext, module: ModuleNode) => {
  const path = ctx.tree.pathOf.get(module.id) ?? [];
  const nodes = path.slice(1).flatMap((id) => ctx.tree.nodes.get(id) ?? []);
  return nodes.length === 0
    ? null
    : h("div", { class: "note" }, "In: ", ...nodes.flatMap((node, position): Child[] => [position > 0 ? " › " : null, link(node.label, () => ctx.open.mapNode(node.id, module.id))]));
};

export const modulePanel = (ctx: PanelContext, moduleId: string, back: { label: string; run: () => void } | null): HTMLElement[] => {
  const module = ctx.index.modules.get(moduleId);
  if (!module) return [h("p", { class: "note" }, "This file is not part of the current scan.")];
  const { metrics, placement } = module;
  const functions = module.functionIds.flatMap((id) => ctx.index.functions.get(id) ?? []);
  const cycleMembers = metrics.cycleGroup === null ? [] : (ctx.index.cycles.get(metrics.cycleGroup) ?? []);
  const outgoing = (ctx.index.importsFrom.get(moduleId) ?? []).filter((edge) => edge.to !== moduleId);
  const incoming = (ctx.index.importsTo.get(moduleId) ?? []).filter((edge) => edge.from !== moduleId);
  const diagnostics = ctx.index.diagnosticsByFile.get(module.path) ?? [];
  return [
    ...(back ? [h("div", { class: "actions" }, h("button", { onClick: back.run }, back.label))] : []),
    h("h2", {}, basename(module.path)),
    h("div", { class: "note path mono" }, module.path),
    sideBadge(ctx, placement.side) ?? h("span", {}),
    ...(placement.entry ? [h("div", {}, h("strong", {}, "◆ "), placement.entry)] : []),
    h("p", { class: "note" }, placement.reason),
    ...(placement.chains.client && placement.chains.client.length > 1
      ? [h("div", { class: "note" }, "Reached from the client bundle through:"), chainList(ctx, placement.chains.client)]
      : []),
    ...(placement.chains.server && placement.chains.server.length > 1
      ? [h("div", { class: "note" }, "Reached from the server through:"), chainList(ctx, placement.chains.server)]
      : []),
    areaTrail(ctx, module) ?? h("span", {}),
    h(
      "div",
      { class: "metrics" },
      metric("Fan-in", metrics.fanIn),
      metric("Fan-out", metrics.fanOut),
      metric("Functions", metrics.functionCount),
      metric("Max CC", formatCC(metrics.maxCC)),
      metric("Mean CC", formatCC(metrics.meanCC)),
      metric("Cycle", metrics.cycleGroup === null ? "none" : `#${metrics.cycleGroup + 1}`, metrics.cycleGroup === null ? "" : "cycle"),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "primary", onClick: () => ctx.open.functions(moduleId) }, "Explore functions"),
      h("button", { onClick: () => ctx.open.pathPicker(moduleId) }, "Find import path…"),
      h("button", { onClick: () => ctx.copy(module.path) }, "Copy path"),
    ),
    ...(ctx.pathPickerFrom === moduleId ? [pathPicker(ctx, moduleId)] : []),
    ...(metrics.cycleGroup === null
      ? []
      : section(
          "Import cycle",
          h("p", { class: "note" }, cycleMembers.length === 1 ? "This file imports itself." : `This file is in a cycle of ${plural(cycleMembers.length, "file")}:`),
          list(cycleMembers.filter((member) => member.id !== moduleId).map((member) => h("li", {}, moduleLink(ctx, member.id))), ""),
        )),
    ...section(`Imports (${outgoing.length})`, importList(ctx, outgoing, "to")),
    ...section(`Imported by (${incoming.length})`, importList(ctx, incoming, "from")),
    ...section(
      `Packages (${module.externals.length})`,
      module.externals.length === 0
        ? h("p", { class: "note" }, "No external packages imported.")
        : h("div", { class: "chips" }, ...module.externals.map((name) => h("span", { class: "chip" }, name))),
    ),
    ...section("Functions by CC", list(functionRankItems(ctx, functions, false), "No functions in this file.")),
    ...(diagnostics.length === 0 ? [] : section("Warnings", list(diagnosticItems(diagnostics), ""))),
  ];
};

const callList = (ctx: PanelContext, edges: readonly CallEdge[], side: "from" | "to", emptyText: string) =>
  list(
    edges.flatMap((edge) => {
      const fn = ctx.index.functions.get(edge[side]);
      return fn ? [h("li", {}, link(fn.name, () => ctx.open.fn(fn.id)), h("span", { class: "aside" }, occurrenceLines(edge.occurrences)))] : [];
    }),
    emptyText,
  );

export const functionPanel = (ctx: PanelContext, functionId: string): HTMLElement[] => {
  const fn = ctx.index.functions.get(functionId);
  if (!fn) return [];
  return [
    h("h2", {}, fn.name),
    h("div", { class: "note path mono" }, fullRef(fn.location)),
    h(
      "div",
      { class: "metrics" },
      metric("CC", fn.complexity),
      metric("Calls", (ctx.index.callsFrom.get(fn.id) ?? []).length),
      metric("Called by", (ctx.index.callsTo.get(fn.id) ?? []).length),
    ),
    h(
      "div",
      { class: "actions" },
      h("button", { class: "primary", onClick: () => ctx.open.logic(fn.id) }, "Show logic"),
      h("button", { onClick: () => ctx.copy(lineRef(fn.location)) }, `Copy ${basename(lineRef(fn.location))}`),
    ),
    ...section("Calls", callList(ctx, ctx.index.callsFrom.get(fn.id) ?? [], "to", "No resolved local calls.")),
    ...section("Called by", callList(ctx, ctx.index.callsTo.get(fn.id) ?? [], "from", "No resolved local callers.")),
    h("p", { class: "note" }, "Only direct calls that resolve to a function declared in this file are shown. Calls to imports, parameters, object methods and dynamic names are left out."),
  ];
};

export const callEdgePanel = (ctx: PanelContext, from: string, to: string): HTMLElement[] => {
  const edge = (ctx.index.callsFrom.get(from) ?? []).find((candidate) => candidate.to === to);
  const caller = ctx.index.functions.get(from);
  const callee = ctx.index.functions.get(to);
  if (!edge || !caller || !callee) return [];
  return [
    h("h2", {}, "Call"),
    h("p", {}, link(caller.name, () => ctx.open.fn(caller.id)), h("span", { class: "muted" }, " calls "), link(callee.name, () => ctx.open.fn(callee.id))),
    ...section(
      `Call sites (${edge.occurrences.length})`,
      list(edge.occurrences.map((location) => h("li", {}, h("span", { class: "mono" }, fullRef(location)), link("Copy", () => ctx.copy(lineRef(location))))), ""),
    ),
  ];
};

export const functionsOverviewPanel = (ctx: PanelContext, moduleId: string): HTMLElement[] => {
  const module = ctx.index.modules.get(moduleId);
  if (!module) return [];
  const functions = module.functionIds.flatMap((id) => ctx.index.functions.get(id) ?? []);
  const calls = functions.reduce((total, fn) => total + (ctx.index.callsFrom.get(fn.id) ?? []).length, 0);
  return [
    h("h2", {}, basename(module.path)),
    h("div", { class: "note path mono" }, module.path),
    h("div", { class: "metrics" }, metric("Functions", functions.length), metric("Local calls", calls), metric("Max CC", formatCC(module.metrics.maxCC))),
    h("div", { class: "actions" }, h("button", { onClick: () => ctx.open.module(moduleId) }, "Show file in the map")),
    ...section("Functions by CC", list(functionRankItems(ctx, functions, false), "No functions in this file.")),
  ];
};

const roleLabels: Readonly<Record<string, string>> = {
  page: "Page component",
  "universal-load": "Universal load",
  "server-load": "Server load / actions",
  endpoint: "API endpoint",
  layout: "Layout component",
  "layout-load": "Layout universal load",
  "layout-server-load": "Layout server load",
  error: "Error page",
};

const roleBadges = (route: Route) =>
  [...new Set(route.files.map((file) => (file.role.startsWith("layout") ? "layout" : file.role === "endpoint" ? "endpoint" : file.side)))].map((label) =>
    h("span", { class: `badge role-${label}` }, label),
  );

export const routesListPanel = (ctx: PanelContext, filter: string, onFilter: (value: string) => void): HTMLElement[] => {
  const multipleApps = new Set(ctx.data.routes.map((route) => route.app)).size > 1;
  const input = h("input", { type: "search", class: "picker-input", placeholder: "Filter routes", value: filter, "aria-label": "Filter routes" }) as HTMLInputElement;
  const results = h("ul", { class: "list" });
  const render = () => {
    const needle = input.value.trim().toLowerCase();
    results.replaceChildren(
      ...ctx.data.routes
        .filter((route) => routeLabel(route, multipleApps).toLowerCase().includes(needle) || route.directory.toLowerCase().includes(needle))
        .map((route) => h("li", {}, link(routeLabel(route, multipleApps), () => ctx.open.route(route.id), route.directory), h("span", { class: "aside" }, ...roleBadges(route)))),
    );
  };
  input.addEventListener("input", () => {
    onFilter(input.value);
    render();
  });
  render();
  return ctx.data.routes.length === 0
    ? [h("h2", {}, "Routes"), h("p", { class: "note" }, "No SvelteKit routes were found. Routes come from +page, +layout, +server and +error files under src/routes.")]
    : [
        h("h2", {}, `Routes (${ctx.data.routes.length})`),
        h("p", { class: "note" }, "Each route lists what its client side (page component, universal load) and its server side (server load, endpoint) pull in. URLs come from the folder names; (groups) are left out of the URL."),
        input,
        results,
      ];
};

export const routePanel = (ctx: PanelContext, route: Route, view: RouteView): HTMLElement[] => {
  const multipleApps = new Set(ctx.data.routes.map((candidate) => candidate.app)).size > 1;
  const clientModules = view.reach.client.flatMap((id) => ctx.index.modules.get(id) ?? []);
  const serverModules = view.reach.server.flatMap((id) => ctx.index.modules.get(id) ?? []);
  const packages = (modules: readonly ModuleNode[], title: string) => {
    const counts = externalCounts(modules);
    return section(
      title,
      counts.length === 0 ? h("p", { class: "note" }, "None.") : h("div", { class: "chips" }, ...counts.slice(0, 20).map(([name]) => h("span", { class: "chip" }, name))),
    );
  };
  return [
    h("div", { class: "actions" }, h("button", { onClick: () => ctx.open.route(null) }, "← All routes")),
    h("div", { class: "note" }, "Route"),
    h("h2", {}, routeLabel(route, multipleApps)),
    h("div", { class: "note path mono" }, route.directory),
    h("div", { class: "metrics" }, metric("Client files", clientModules.length), metric("Server files", serverModules.length), metric("Layouts", route.layouts.length)),
    ...section(
      "Route files",
      list(route.files.map((file) => h("li", {}, moduleLink(ctx, file.moduleId, basename(ctx.index.modules.get(file.moduleId)?.path ?? file.moduleId)), h("span", { class: "aside" }, roleLabels[file.role] ?? file.role))), ""),
    ),
    ...section("Wrapped by layouts", list(route.layouts.map((id) => h("li", {}, moduleLink(ctx, id))), "No parent layouts.")),
    ...packages(clientModules, "Packages on the client side"),
    ...packages(serverModules, "Packages on the server side"),
  ];
};

export const routeItemPanel = (ctx: PanelContext, item: MapItem, backToRoute: () => void): HTMLElement[] =>
  item.kind === "file"
    ? modulePanel(ctx, item.moduleIds[0] as string, { label: "← Back to route", run: backToRoute })
    : [
        h("div", { class: "actions" }, h("button", { onClick: backToRoute }, "← Back to route")),
        h("div", { class: "note" }, "Reached further down"),
        h("h2", {}, item.label),
        h("p", { class: "note" }, `${plural(item.moduleIds.length, "file")} in this group are reached by the route through longer import chains.`),
        ...(item.target ? [h("div", { class: "actions" }, h("button", { class: "primary", onClick: () => ctx.open.mapNode(item.target as string) }, "Open in the map"))] : []),
        ...section("Files reached", limitList(fileItems(ctx, item.moduleIds), 40, "")),
      ];

export const pathPanel = (ctx: PanelContext, ids: readonly string[], close: () => void): HTMLElement[] => [
  h("div", { class: "actions" }, h("button", { onClick: close }, "← Close path")),
  h("h2", {}, "Import path"),
  h("p", { class: "note" }, `${plural(ids.length - 1, "import")} from the first file to the last. Each file imports the next one.`),
  chainList(ctx, ids),
];

export type LogicActions = {
  select: (id: string | null) => void;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseBranches: () => void;
  collapsed: ReadonlySet<string>;
};

const kindNames: Readonly<Record<string, string>> = {
  start: "Start",
  block: "Steps",
  decision: "Decision",
  loop: "Loop",
  switch: "Switch",
  try: "Try",
  catch: "Catch",
  finally: "Finally",
  return: "Return",
  throw: "Throw",
  end: "End",
};

const structural = new Set(["decision", "loop", "switch", "try"]);

const firstLine = (label: string) => label.split("\n")[0] ?? label;

const weightReason = (node: LogicNode) => {
  const inside = (count: number) => (count > 0 ? ` and +${count} for &&, ||, ??, ?., ?: or default values inside it` : "");
  if (node.kind === "decision") return `+1 for this ${firstLine(node.label).startsWith("while") ? "loop condition" : "if"}${inside(node.weight - 1)}.`;
  if (node.kind === "loop") return `+1 for the loop${inside(node.weight - 1)}.`;
  if (node.kind === "switch") return "+1 for each case other than default (plus any &&, ||, ??, ?. or ?: in the cases).";
  if (node.kind === "catch") return `+1 for the catch${inside(node.weight - 1)}.`;
  if (node.kind === "start") return `+${node.weight} for default values or short-circuit operators in the parameters.`;
  return `+${node.weight} for ?:, &&, ||, ??, ?. or default values inside these statements.`;
};

const codeBlock = (logic: FunctionLogic, start: number, end: number) => {
  const from = Math.max(start, logic.source.firstLine);
  const to = Math.min(end, from + 39, logic.source.firstLine + logic.source.lines.length - 1);
  const lines = logic.source.lines.slice(from - logic.source.firstLine, to - logic.source.firstLine + 1);
  return h(
    "pre",
    { class: "code" },
    ...lines.map((text, offset) => h("span", { class: "code-line" }, h("span", { class: "code-number" }, String(from + offset)), text)),
    ...(to < end ? [h("span", { class: "code-line muted" }, `… ${end - to} more lines`)] : []),
  );
};

const outlineList = (items: readonly LogicOutlineItem[], select: (id: string) => void): HTMLElement =>
  h(
    "ul",
    { class: "outline" },
    ...items.map((item) =>
      h(
        "li",
        {},
        item.nodeId ? link(item.text, () => select(item.nodeId as string)) : h("span", {}, item.text),
        item.children.length > 0 ? outlineList(item.children, select) : null,
      ),
    ),
  );

export const logicPanel = (ctx: PanelContext, logic: FunctionLogic, selected: string | null, actions: LogicActions): HTMLElement[] => {
  const ref = `${logic.file}:${logic.source.firstLine}`;
  if (selected?.startsWith("collapsed:")) {
    const owner = logic.nodes.find((node) => node.id === selected.slice("collapsed:".length));
    return [
      h("div", { class: "actions" }, h("button", { onClick: () => actions.select(null) }, "← Function overview")),
      h("h2", {}, "Collapsed steps"),
      h("p", { class: "note" }, `The steps inside ${owner ? firstLine(owner.label) : "this branch"} are folded to keep the chart readable.`),
      h("div", { class: "actions" }, h("button", { class: "primary", onClick: () => owner && actions.toggle(owner.id) }, "Expand")),
    ];
  }
  const node = selected ? logic.nodes.find((candidate) => candidate.id === selected) : undefined;
  if (!node) {
    const weighted = logic.nodes.filter((candidate) => candidate.weight > 0).sort((a, b) => a.lines.start - b.lines.start);
    const exits = logic.nodes.filter((candidate) => ["return", "throw", "end"].includes(candidate.kind)).length;
    return [
      h("div", { class: "note" }, "Function logic"),
      h("h2", {}, logic.name),
      h("div", { class: "note path mono" }, ref),
      h(
        "div",
        { class: "metrics" },
        metric("CC", logic.complexity),
        metric("Decisions", weighted.length),
        metric("Ways out", exits),
      ),
      h(
        "div",
        { class: "actions" },
        h("button", { onClick: () => ctx.copy(ref) }, "Copy path:line"),
        h("button", { onClick: actions.expandAll }, "Expand all"),
        h("button", { onClick: actions.collapseBranches }, "Collapse branches"),
      ),
      ...section(
        `Why CC is ${logic.complexity}`,
        list(
          [
            h("li", {}, h("span", {}, "+1 the function itself"), h("span", { class: "aside" }, "")),
            ...weighted.map((candidate) =>
              h(
                "li",
                {},
                link(`+${candidate.weight}  ${firstLine(candidate.label)}`, () => actions.select(candidate.id)),
                h("span", { class: "aside" }, `line ${candidate.lines.start}`),
              ),
            ),
          ],
          "",
        ),
      ),
      ...section("Outline", logic.outline.length > 0 ? outlineList(logic.outline, actions.select) : h("p", { class: "note" }, "Empty function.")),
      h(
        "p",
        { class: "note" },
        "A static view of every possible path through the function, not a record of what ran. Select a step to highlight every path through it; double-click a decision, loop or try to fold it.",
      ),
    ];
  }
  const nestedFunctions = node.nested.flatMap((id) => ctx.index.functions.get(id) ?? []);
  return [
    h("div", { class: "actions" }, h("button", { onClick: () => actions.select(null) }, "← Function overview")),
    h("div", { class: "note" }, `${kindNames[node.kind] ?? node.kind} · ${node.lines.start === node.lines.end ? `line ${node.lines.start}` : `lines ${node.lines.start}–${node.lines.end}`}`),
    h("h2", { class: "mono" }, firstLine(node.label)),
    ...(node.unreachable ? [h("p", { class: "warning-note" }, "No path from the start of the function reaches this step.")] : []),
    ...(node.weight > 0 ? [h("p", { class: "note" }, `Adds ${node.weight} to CC: ${weightReason(node)}`)] : []),
    ...(node.kind === "end" ? [h("p", { class: "note" }, "The function finishes here without a return statement.")] : []),
    h(
      "div",
      { class: "actions" },
      ...(structural.has(node.kind)
        ? [h("button", { onClick: () => actions.toggle(node.id) }, actions.collapsed.has(node.id) ? "Expand" : "Collapse")]
        : []),
      h("button", { onClick: () => ctx.copy(`${logic.file}:${node.lines.start}`) }, "Copy path:line"),
    ),
    ...(node.kind === "end" ? [] : [codeBlock(logic, node.lines.start, node.lines.end)]),
    ...(node.calls.length > 0 ? section("Calls", h("div", { class: "chips" }, ...node.calls.map((call) => h("span", { class: "chip" }, call)))) : []),
    ...(node.awaits ? [h("p", { class: "note" }, "Waits for a promise here (await).")] : []),
    ...(nestedFunctions.length > 0
      ? section(
          "Functions defined here",
          list(nestedFunctions.map((fn) => h("li", {}, link(fn.name, () => ctx.open.logic(fn.id)), h("span", { class: "badge" }, fn.complexity))), ""),
        )
      : []),
    h("p", { class: "note" }, "Highlighted: every path that goes through this step."),
  ];
};
