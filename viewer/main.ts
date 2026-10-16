import type cytoscape from "cytoscape";
import type { FunctionLogic, GraphSnapshot, Side } from "../src/model";
import { type Index, buildIndex, folderLabel, lineRef, moduleIdOf, routeLabel, splitEdgeId } from "./data";
import { basename, byId, h, plural } from "./dom";
import { defaultCollapsed, flowPositions, flowView, structuralKinds } from "./flow";
import {
  type ColorMode,
  type FunctionLayout,
  type ModuleLayout,
  bucketLabels,
  createGraph,
  emphasise,
  fitVisible,
  flowElements,
  highlightPaths,
  forceLayoutLimit,
  functionElements,
  graphStyle,
  mapElements,
  mapPositions,
  moduleElements,
  restoreStructure,
  runForceLayout,
  sidesPositions,
  sizeStructureLabels,
  wheelZoom,
} from "./graph";
import {
  type Grouping,
  type MapView,
  type RouteView,
  type Tree,
  ancestry,
  buildRouteView,
  buildTree,
  buildView,
  deepestNode,
  pathView,
  shortestPath,
  traySides,
  viewMode,
} from "./map";
import {
  type PanelContext,
  callEdgePanel,
  folderEdgePanel,
  folderPanel,
  functionPanel,
  functionsOverviewPanel,
  importEdgePanel,
  linkPanel,
  logicPanel,
  modulePanel,
  nodePanel,
  overviewPanel,
  pathPanel,
  routeItemPanel,
  routePanel,
  routesListPanel,
} from "./panels";

type Tab = "map" | "routes" | "all" | "functions" | "logic";
type SearchHit = { label: string; detail: string; run: () => void };

const elements = {
  projectName: byId<HTMLElement>("project-name"),
  scanInfo: byId<HTMLElement>("scan-info"),
  tabs: {
    map: byId<HTMLButtonElement>("tab-map"),
    routes: byId<HTMLButtonElement>("tab-routes"),
    all: byId<HTMLButtonElement>("tab-all"),
    functions: byId<HTMLButtonElement>("tab-functions"),
  },
  graphs: {
    map: byId<HTMLElement>("map-graph"),
    routes: byId<HTMLElement>("routes-graph"),
    all: byId<HTMLElement>("modules-graph"),
    functions: byId<HTMLElement>("functions-graph"),
    logic: byId<HTMLElement>("logic-graph"),
  },
  search: byId<HTMLInputElement>("search"),
  searchResults: byId<HTMLUListElement>("search-results"),
  grouping: byId<HTMLSelectElement>("grouping"),
  color: byId<HTMLSelectElement>("color"),
  cyclesOnly: byId<HTMLInputElement>("cycles-only"),
  focus: byId<HTMLInputElement>("focus"),
  layout: byId<HTMLSelectElement>("layout"),
  fit: byId<HTMLButtonElement>("fit"),
  rescan: byId<HTMLButtonElement>("rescan"),
  warnings: byId<HTMLButtonElement>("warnings"),
  crumbs: byId<HTMLElement>("crumbs"),
  empty: byId<HTMLElement>("empty"),
  legend: byId<HTMLElement>("legend"),
  toast: byId<HTMLElement>("toast"),
  details: byId<HTMLElement>("details"),
  diagnostics: byId<HTMLElement>("diagnostics"),
  diagnosticsList: byId<HTMLUListElement>("diagnostics-list"),
  closeDiagnostics: byId<HTMLButtonElement>("close-diagnostics"),
  trayInputs: [...document.querySelectorAll<HTMLInputElement>("input[data-tray]")],
  tabControls: [...document.querySelectorAll<HTMLElement>("[data-tabs]")],
};

const state = {
  snapshot: null as GraphSnapshot | null,
  index: null as Index | null,
  tree: null as Tree | null,
  tab: "map" as Tab,
  previousTab: "map" as Tab,
  color: "side" as ColorMode,
  map: {
    node: "root",
    selected: null as string | null,
    grouping: "areas" as Grouping,
    tray: new Set<Side>(),
    path: null as string[] | null,
    view: null as MapView | null,
  },
  routes: { selected: null as string | null, item: null as string | null, filter: "", view: null as RouteView | null },
  all: { selected: null as string | null, focus: false, layout: "structure" as ModuleLayout, moved: false },
  functions: {
    explored: null as string | null,
    selected: null as string | null,
    focus: false,
    layout: "cose" as FunctionLayout,
    positions: null as Map<string, cytoscape.Position> | null,
  },
  logic: {
    functionId: null as string | null,
    data: null as FunctionLogic | null,
    selected: null as string | null,
    collapsed: new Set<string>(),
  },
  cy: { map: null, routes: null, all: null, functions: null, logic: null } as Record<Tab, cytoscape.Core | null>,
  pathPickerFrom: null as string | null,
  scanning: false,
  searchHits: [] as SearchHit[],
  activeHit: 0,
  applyingHash: false,
};

const data = () => state.snapshot as GraphSnapshot;
const index = () => state.index as Index;
const tree = () => state.tree as Tree;

let toastTimer: ReturnType<typeof setTimeout> | undefined;
const toast = (message: string, isError = false) => {
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (elements.toast.hidden = true), isError ? 6000 : 2400);
};

const copy = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => toast(`Copied ${text}`),
    () => toast(`Could not copy. ${text}`, true),
  );

const showEmpty = (message: string | null) => {
  elements.empty.textContent = message ?? "";
  elements.empty.hidden = message === null;
};

const writeHash = (push: boolean) => {
  if (state.applyingHash || !state.snapshot) return;
  const params = new URLSearchParams();
  params.set("tab", state.tab);
  if (state.tab === "map") {
    if (state.map.path) params.set("path", `${state.map.path[0]}|${state.map.path[state.map.path.length - 1]}`);
    else params.set("node", state.map.node);
    if (state.map.selected) params.set("sel", state.map.selected);
  }
  if (state.tab === "routes") {
    if (state.routes.selected) params.set("route", state.routes.selected);
    if (state.routes.item) params.set("item", state.routes.item);
  }
  if (state.tab === "all" && state.all.selected) params.set("sel", state.all.selected);
  if (state.tab === "functions" && state.functions.explored) {
    params.set("file", state.functions.explored);
    if (state.functions.selected) params.set("fn", state.functions.selected);
  }
  if (state.tab === "logic" && state.logic.functionId) {
    params.set("logic", state.logic.functionId);
    if (state.logic.selected) params.set("step", state.logic.selected);
  }
  params.set("group", state.map.grouping);
  params.set("color", state.color);
  if (state.map.tray.size > 0) params.set("tray", [...state.map.tray].join(","));
  const hash = `#${params.toString()}`;
  if (hash === window.location.hash) return;
  if (push) window.history.pushState(null, "", hash);
  else window.history.replaceState(null, "", hash);
};

const panelContext = (): PanelContext => ({
  data: data(),
  index: index(),
  tree: tree(),
  pathPickerFrom: state.pathPickerFrom,
  open: {
    module: (moduleId) => revealModule(moduleId),
    mapNode: (nodeId, selected = null) => openMapNode(nodeId, selected),
    mapItem: (itemId) => selectIn("map", itemId),
    functions: (moduleId, functionId = null) => exploreFunctions(moduleId, functionId),
    fn: (functionId) => selectIn("functions", functionId),
    logic: (functionId) => void openLogic(functionId),
    route: (routeId) => openRoute(routeId),
    routeItem: (itemId) => selectIn("routes", itemId),
    allFilesItem: (id) => openAllFiles(id),
    path: (from, to) => openPath(from, to),
    pathPicker: (from) => {
      state.pathPickerFrom = from;
      renderDetails();
    },
  },
  copy,
});

const currentSelection = (tab: Tab) =>
  tab === "map"
    ? state.map.selected
    : tab === "routes"
      ? state.routes.item
      : tab === "all"
        ? state.all.selected
        : tab === "logic"
          ? state.logic.selected
          : state.functions.selected;

const syncSelection = (cy: cytoscape.Core, id: string | null) => {
  const element = id ? cy.getElementById(id) : null;
  if (!element || element.empty()) cy.elements(":selected").unselect();
  else if (!element.selected()) {
    cy.elements(":selected").unselect();
    element.select();
  }
};

const containerOf = (tab: Tab) => elements.graphs[tab];

const wireCommonEvents = (cy: cytoscape.Core, tab: Tab) => {
  cy.on("tap", "node, edge", (event) => selectIn(tab, (event.target as cytoscape.SingularElementArgument).id()));
  cy.on("tap", (event) => {
    if (event.target === cy) selectIn(tab, null);
  });
};

const wireHover = (cy: cytoscape.Core, tab: Tab) => {
  cy.on("mouseover", "node", (event) => emphasise(cy, (event.target as cytoscape.NodeSingular).id()));
  cy.on("mouseout", "node", () => emphasise(cy, currentSelection(tab)));
};

const mapView = (): MapView =>
  state.map.path ? pathView(data(), state.map.path) : buildView(data(), tree(), state.map.node);

const renderMapGraph = () => {
  const view = mapView();
  state.map.view = view;
  const positions =
    !state.map.path && state.map.node === "root" ? sidesPositions(view.items, new Set(traySides)) : mapPositions(view, 1);
  state.cy.map?.destroy();
  const cy = createGraph(containerOf("map"), mapElements(view, positions), state.color);
  state.cy.map = cy;
  wireCommonEvents(cy, "map");
  wireHover(cy, "map");
  cy.on("dbltap", "node", (event) => openItem((event.target as cytoscape.NodeSingular).id()));
  if (state.map.selected && cy.getElementById(state.map.selected).empty()) state.map.selected = null;
  emphasise(cy, state.map.selected);
  syncSelection(cy, state.map.selected);
  fitVisible(cy);
};

const renderRoutesGraph = () => {
  state.cy.routes?.destroy();
  state.cy.routes = null;
  const route = state.routes.selected ? index().routes.get(state.routes.selected) : undefined;
  if (!route) {
    state.routes.view = null;
    return;
  }
  const view = buildRouteView(data(), tree(), route);
  state.routes.view = view;
  const cy = createGraph(containerOf("routes"), mapElements(view, mapPositions(view, 2)), state.color);
  state.cy.routes = cy;
  wireCommonEvents(cy, "routes");
  wireHover(cy, "routes");
  cy.on("dbltap", "node", (event) => {
    const item = view.items.find((candidate) => candidate.id === (event.target as cytoscape.NodeSingular).id());
    if (item?.kind === "file") exploreFunctions(item.moduleIds[0] as string);
    else if (item?.target) openMapNode(item.target);
  });
  if (state.routes.item && cy.getElementById(state.routes.item).empty()) state.routes.item = null;
  emphasise(cy, state.routes.item);
  syncSelection(cy, state.routes.item);
  fitVisible(cy);
};

const fileNeighbours = (files: cytoscape.NodeCollection) => files.connectedEdges(".file-edge").connectedNodes();

const allFocusSet = (selected: cytoscape.CollectionReturnValue): cytoscape.NodeCollection => {
  const id = selected.id();
  if (id.startsWith("module:")) return selected.nodes().union(fileNeighbours(selected.nodes()));
  if (id.startsWith("group:")) {
    const files = selected.nodes().children();
    return files.union(fileNeighbours(files));
  }
  const edge = selected as unknown as cytoscape.EdgeSingular;
  if (id.startsWith("folders:")) return edge.source().children().union(edge.target().children());
  return edge.connectedNodes();
};

const highlightAll = (cy: cytoscape.Core, selected: cytoscape.CollectionReturnValue) => {
  const id = selected.id();
  const files = cy.nodes(".file");
  if (id.startsWith("module:")) {
    const outgoing = selected.outgoers("edge.file-edge");
    const incoming = selected.incomers("edge.file-edge");
    outgoing.removeClass("hidden").addClass("outgoing");
    incoming.removeClass("hidden").addClass("incoming");
    files.not(selected.union(outgoing.targets()).union(incoming.sources())).addClass("dim");
    cy.edges(".group-edge").addClass("dim");
  } else if (id.startsWith("group:")) {
    const edges = selected.connectedEdges(".group-edge");
    edges.filter((edge) => edge.source().id() === id).addClass("outgoing");
    edges.filter((edge) => edge.target().id() === id).addClass("incoming");
    cy.edges(".group-edge").not(edges).addClass("dim");
    files.not(selected.children()).addClass("dim");
  } else {
    const edge = selected as unknown as cytoscape.EdgeSingular;
    edge.removeClass("hidden").addClass("outgoing");
    const ends = id.startsWith("folders:") ? edge.source().children().union(edge.target().children()) : edge.connectedNodes();
    files.not(ends).addClass("dim");
    cy.edges(".group-edge").not(edge).addClass("dim");
  }
};

const refreshAllGraph = (relayout: boolean) => {
  const cy = state.cy.all;
  if (!cy) return;
  const selectedId = state.all.selected;
  const selected = selectedId && cy.getElementById(selectedId).nonempty() ? cy.getElementById(selectedId) : null;
  const focused = state.all.focus && selected !== null;
  const filtered = elements.cyclesOnly.checked || focused;
  cy.batch(() => {
    cy.elements().removeClass("dim outgoing incoming hidden");
    const visible = focused && selected ? allFocusSet(selected) : elements.cyclesOnly.checked ? cy.nodes(".file[?cyclic]") : cy.nodes(".file");
    if (filtered) {
      cy.nodes(".file").not(visible).addClass("hidden");
      cy.nodes(".group").filter((group) => group.children(".file").not(".hidden").empty()).addClass("hidden");
      cy.nodes(".lane").filter((lane) => lane.children(".group").not(".hidden").empty()).addClass("hidden");
      cy.edges(".group-edge").addClass("hidden");
      cy.edges(".file-edge").filter((edge) => edge.source().hasClass("hidden") || edge.target().hasClass("hidden")).addClass("hidden");
    } else {
      cy.edges(".file-edge").addClass("hidden");
    }
    if (selected) highlightAll(cy, selected);
  });
  syncSelection(cy, selected ? selectedId : null);
  if (!relayout) return;
  const visibleCount = cy.nodes(".file").not(".hidden").length;
  if (state.all.layout === "force" && visibleCount > forceLayoutLimit) {
    state.all.layout = "structure";
    toast(`Force layout works on up to ${forceLayoutLimit} files. Use "Cycles only" or "Focus selection" first.`, true);
    renderLayoutOptions();
  }
  if (state.all.layout === "force") {
    state.all.moved = true;
    runForceLayout(cy);
  } else {
    if (state.all.moved) restoreStructure(cy, data());
    state.all.moved = false;
    fitVisible(cy);
  }
};

const ensureAllGraph = () => {
  if (state.cy.all) return;
  const cy = createGraph(containerOf("all"), moduleElements(data()), state.color);
  state.cy.all = cy;
  sizeStructureLabels(cy);
  wireCommonEvents(cy, "all");
  cy.on("dbltap", "node.file", (event) => exploreFunctions((event.target as cytoscape.NodeSingular).id()));
  if (state.all.selected && cy.getElementById(state.all.selected).empty()) state.all.selected = null;
  refreshAllGraph(elements.cyclesOnly.checked || state.all.focus || state.all.layout === "force");
};

const refreshFunctionGraph = (relayout: boolean) => {
  const cy = state.cy.functions;
  if (!cy) return;
  const id = state.functions.selected;
  const selected = id && cy.getElementById(id).nonempty() ? cy.getElementById(id) : null;
  const asEdge = selected as unknown as cytoscape.EdgeSingular | null;
  const around = selected
    ? selected.isNode()
      ? selected.closedNeighborhood()
      : (asEdge as cytoscape.EdgeSingular).union((asEdge as cytoscape.EdgeSingular).connectedNodes())
    : null;
  const filtered = state.functions.focus && around !== null;
  cy.batch(() => {
    cy.elements().removeClass("hidden");
    if (filtered && around) cy.nodes().not(around.nodes()).addClass("hidden");
  });
  emphasise(cy, selected ? id : null);
  syncSelection(cy, selected ? id : null);
  if (!relayout) return;
  if (filtered) {
    state.functions.positions ??= new Map(cy.nodes().map((node) => [node.id(), { ...node.position() }]));
    runForceLayout(cy, state.functions.layout === "breadthfirst");
  } else if (state.functions.positions) {
    const saved = state.functions.positions;
    cy.nodes().positions((node) => saved.get(node.id()) ?? node.position());
    state.functions.positions = null;
    fitVisible(cy);
  }
};

const showTab = (tab: Tab) => {
  if (tab !== "functions" && tab !== "logic") state.previousTab = tab;
  state.tab = tab;
  (Object.keys(elements.graphs) as Tab[]).forEach((name) => {
    elements.graphs[name].hidden = name !== tab;
  });
  if (tab === "all") ensureAllGraph();
  state.cy[tab]?.resize();
};

const centerOn = (cy: cytoscape.Core, id: string) => {
  const element = cy.getElementById(id);
  if (element.empty() || element.hasClass("hidden")) return;
  cy.animate(
    { center: { eles: element }, zoom: Math.max(cy.zoom(), element.isNode() && element.isParent() ? cy.zoom() : 1) },
    { duration: 250 },
  );
};

const selectIn = (tab: Tab, id: string | null) => {
  if (tab === "map" || tab === "routes") {
    if (tab === "map") state.map.selected = id;
    else state.routes.item = id;
    const cy = state.cy[tab];
    if (cy) {
      emphasise(cy, id);
      syncSelection(cy, id);
    }
  } else if (tab === "logic") {
    state.logic.selected = id;
    const cy = state.cy.logic;
    if (cy) {
      highlightPaths(cy, id);
      syncSelection(cy, id);
    }
  } else if (tab === "all") {
    const refocus = state.all.focus && state.all.selected !== id;
    state.all.selected = id;
    if (id === null) state.all.focus = false;
    refreshAllGraph(refocus);
  } else {
    const refocus = state.functions.focus && state.functions.selected !== id;
    state.functions.selected = id;
    if (id === null) state.functions.focus = false;
    refreshFunctionGraph(refocus);
  }
  state.pathPickerFrom = null;
  refresh();
  writeHash(false);
};

const openMapNode = (nodeId: string, selected: string | null = null) => {
  showTab("map");
  state.map.node = tree().nodes.has(nodeId) ? nodeId : "root";
  state.map.path = null;
  state.map.selected = selected;
  state.pathPickerFrom = null;
  renderMapGraph();
  const cy = state.cy.map;
  const node = tree().nodes.get(state.map.node);
  if (cy && selected && node && viewMode(node) === "files") centerOn(cy, selected);
  refresh();
  writeHash(true);
};

const openItem = (id: string) => {
  const item = state.map.view?.items.find((candidate) => candidate.id === id);
  if (!item) return;
  if (item.kind === "file") exploreFunctions(item.moduleIds[0] as string);
  else if (item.target) openMapNode(item.target);
};

const rebuildTree = () => {
  state.tree = buildTree(data(), { grouping: state.map.grouping, tray: state.map.tray });
  if (!tree().nodes.has(state.map.node)) state.map.node = "root";
};

const syncTrayInputs = () =>
  elements.trayInputs.forEach((input) => {
    input.checked = state.map.tray.has(input.dataset.tray as Side);
  });

const revealModule = (moduleId: string) => {
  if (state.tab === "all") return openAllFiles(moduleId);
  const module = index().modules.get(moduleId);
  if (!module) return;
  if (!tree().pathOf.has(moduleId) && traySides.includes(module.placement.side)) {
    state.map.tray.add(module.placement.side);
    syncTrayInputs();
    rebuildTree();
  }
  openMapNode(deepestNode(tree(), moduleId) ?? "root", moduleId);
};

const openAllFiles = (id: string | null) => {
  showTab("all");
  const cy = state.cy.all;
  const hidden = id && cy ? cy.getElementById(id).hasClass("hidden") : false;
  if (hidden) {
    elements.cyclesOnly.checked = false;
    state.all.focus = false;
  }
  state.all.selected = id;
  refreshAllGraph(hidden);
  if (cy && id) centerOn(cy, id);
  refresh();
  writeHash(true);
};

const openRoute = (routeId: string | null) => {
  showTab("routes");
  state.routes.selected = routeId && index().routes.has(routeId) ? routeId : null;
  state.routes.item = null;
  renderRoutesGraph();
  refresh();
  writeHash(true);
};

const openPath = (from: string, to: string) => {
  const forward = shortestPath(data(), from, to);
  const ids = forward ?? shortestPath(data(), to, from);
  state.pathPickerFrom = null;
  if (!ids) {
    toast(`No import chain connects ${basename(from)} and ${basename(to)} in either direction.`, true);
    renderDetails();
    return;
  }
  if (!forward) toast("No chain in that direction; showing the reverse chain.");
  showTab("map");
  state.map.path = ids;
  state.map.selected = null;
  renderMapGraph();
  refresh();
  writeHash(true);
};

const exploreFunctions = (moduleId: string, functionId: string | null = null) => {
  const module = index().modules.get(moduleId);
  if (!module) return;
  const sameModule = state.functions.explored === moduleId && state.cy.functions !== null;
  showTab("functions");
  state.functions.explored = moduleId;
  if (!sameModule) {
    state.cy.functions?.destroy();
    state.functions.selected = null;
    state.functions.focus = false;
    state.functions.positions = null;
    const functions = module.functionIds.flatMap((id) => index().functions.get(id) ?? []);
    const cy = createGraph(
      containerOf("functions"),
      functionElements(functions, (id) => index().callsFrom.get(id) ?? []),
      state.color,
    );
    state.cy.functions = cy;
    wireCommonEvents(cy, "functions");
    wireHover(cy, "functions");
    cy.on("dbltap", "node", (event) => void openLogic((event.target as cytoscape.NodeSingular).id()));
    runForceLayout(cy, state.functions.layout === "breadthfirst");
  }
  state.functions.selected = functionId ?? (sameModule ? state.functions.selected : null);
  refreshFunctionGraph(false);
  const cy = state.cy.functions;
  if (cy && functionId) centerOn(cy, functionId);
  refresh();
  writeHash(true);
};

const renderLogicGraph = (refit: boolean) => {
  const logic = state.logic.data;
  if (!logic) return;
  const previous = state.cy.logic;
  const viewport = previous && !refit ? { zoom: previous.zoom(), pan: { ...previous.pan() } } : null;
  previous?.destroy();
  const view = flowView(logic, state.logic.collapsed);
  const cy = createGraph(containerOf("logic"), flowElements(view, flowPositions(view)), state.color);
  state.cy.logic = cy;
  wireCommonEvents(cy, "logic");
  cy.on("dbltap", "node", (event) => {
    const id = (event.target as cytoscape.NodeSingular).id();
    const owner = id.startsWith("collapsed:") ? id.slice("collapsed:".length) : id;
    const node = logic.nodes.find((candidate) => candidate.id === owner);
    if (node && structuralKinds.has(node.kind)) toggleLogic(owner);
  });
  if (state.logic.selected && cy.getElementById(state.logic.selected).empty()) state.logic.selected = null;
  highlightPaths(cy, state.logic.selected);
  syncSelection(cy, state.logic.selected);
  if (viewport) cy.viewport(viewport);
  else {
    fitVisible(cy);
    if (cy.zoom() < 0.55) {
      cy.zoom(0.9);
      cy.center(cy.nodes(".flow-start"));
      cy.panBy({ x: 0, y: -(cy.height() / 2 - 60) });
    }
  }
};

const toggleLogic = (id: string) => {
  const collapsed = new Set(state.logic.collapsed);
  if (collapsed.has(id)) collapsed.delete(id);
  else collapsed.add(id);
  state.logic.collapsed = collapsed;
  if (state.logic.selected === `collapsed:${id}`) state.logic.selected = id;
  renderLogicGraph(false);
  refresh();
};

const logicCache = new Map<string, FunctionLogic>();

const openLogic = async (functionId: string, step: string | null = null, push = true) => {
  const fn = index().functions.get(functionId);
  if (!fn) return;
  const key = `${data().scannedAt}|${functionId}`;
  const cached = logicCache.get(key);
  const response = cached ? null : await fetch(`/api/logic?fn=${encodeURIComponent(functionId)}`).catch(() => null);
  const loaded = cached ?? (response?.ok ? ((await response.json()) as FunctionLogic) : null);
  if (!loaded) {
    const body = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
    toast(`Could not load the logic of ${fn.name}: ${body.error ?? "the server is not reachable"}.`, true);
    return;
  }
  logicCache.set(key, loaded);
  state.functions.explored = fn.moduleId;
  state.functions.selected = functionId;
  state.logic.functionId = functionId;
  state.logic.data = loaded;
  state.logic.selected = step;
  state.logic.collapsed = defaultCollapsed(loaded);
  showTab("logic");
  renderLogicGraph(true);
  refresh();
  writeHash(push);
};

const goUp = () => {
  if (state.tab === "logic") {
    if (state.functions.explored) exploreFunctions(state.functions.explored, state.logic.functionId);
    return;
  }
  if (state.tab === "functions") {
    if (state.previousTab === "map") openMapNode(state.map.node, state.map.selected);
    else if (state.previousTab === "routes") openRoute(state.routes.selected);
    else openAllFiles(state.functions.explored);
    return;
  }
  if (state.tab === "routes") {
    if (state.routes.item) selectIn("routes", null);
    else if (state.routes.selected) openRoute(null);
    return;
  }
  if (state.tab === "map") {
    if (state.map.path) return openMapNode(state.map.node);
    const parent = tree().nodes.get(state.map.node)?.parent;
    if (parent) openMapNode(parent, state.map.node);
  }
};

const crumb = (label: string, run: (() => void) | null) =>
  run ? h("button", { class: "link", onClick: run }, label) : h("strong", {}, label);

const separator = () => h("span", { class: "muted" }, " › ");

const hintLine = (text: string) => h("div", { class: "hint" }, text);

const renderCrumbs = () => {
  if (!state.snapshot) return;
  if (state.tab === "map") {
    if (state.map.path) {
      const ids = state.map.path;
      elements.crumbs.replaceChildren(
        h(
          "div",
          {},
          crumb("Map", () => openMapNode(state.map.node)),
          separator(),
          crumb(`Import path: ${basename(ids[0] ?? "")} → ${basename(ids[ids.length - 1] ?? "")}`, null),
        ),
        hintLine("Each file imports the next one. Backspace closes the path."),
      );
      return;
    }
    const trail = ancestry(tree(), state.map.node).flatMap((id) => tree().nodes.get(id) ?? []);
    const node = tree().nodes.get(state.map.node);
    const mode = node ? viewMode(node) : "cards";
    const count = node ? (mode === "cards" ? plural(node.children.length, "part") : plural(node.moduleIds.length, "file")) : "";
    elements.crumbs.replaceChildren(
      h(
        "div",
        {},
        ...trail.flatMap((item, position) =>
          [
            position > 0 ? separator() : null,
            crumb(item.label, position === trail.length - 1 ? null : () => openMapNode(item.id, trail[position + 1]?.id ?? null)),
          ].filter((part): part is HTMLElement => part !== null),
        ),
        h("span", { class: "muted" }, ` · ${count}`),
      ),
      hintLine(
        mode === "cards"
          ? "Double-click a card (or select it and press Enter) to open it · Backspace goes up · Hover to see what it uses"
          : "Double-click a file to see its functions · Dashed cards are outside this view · Backspace goes up",
      ),
    );
    return;
  }
  if (state.tab === "routes") {
    const route = state.routes.selected ? index().routes.get(state.routes.selected) : undefined;
    const multipleApps = new Set(data().routes.map((candidate) => candidate.app)).size > 1;
    elements.crumbs.replaceChildren(
      h(
        "div",
        {},
        crumb("Routes", route ? () => openRoute(null) : null),
        ...(route ? [separator(), crumb(routeLabel(route, multipleApps), null)] : []),
      ),
      hintLine(
        route
          ? "Left: client side · Right: server side · Top: route files · Cards: everything reached further down"
          : "Pick a route from the list on the right.",
      ),
    );
    return;
  }
  if (state.tab === "all") {
    elements.crumbs.replaceChildren(
      h("div", {}, crumb("All files", null)),
      hintLine("Every file at once, by side and folder. Select a file to see its own imports."),
    );
    return;
  }
  const module = state.functions.explored ? index().modules.get(state.functions.explored) : undefined;
  if (state.tab === "logic") {
    elements.crumbs.replaceChildren(
      h(
        "div",
        {},
        h("button", { onClick: goUp }, "← Back"),
        " ",
        h("span", { class: "mono" }, module?.path ?? ""),
        separator(),
        crumb(`${state.logic.data?.name ?? ""} · logic`, null),
      ),
      hintLine("Select a step to highlight every path through it · Double-click a decision, loop or try to fold it · Backspace goes back"),
    );
    return;
  }
  elements.crumbs.replaceChildren(
    h("div", {}, h("button", { onClick: goUp }, "← Back"), " ", h("span", { class: "mono" }, module?.path ?? "")),
    hintLine("Functions declared in this file. Arrows are calls written inside the file. Double-click a function to see its logic."),
  );
};

const legendRow = (marker: HTMLElement, text: string) => h("div", { class: "swatch" }, marker, text);
const swatch = (variable: string, shape = "dot") => h("span", { class: shape, style: `background: var(${variable})` });

const complexitySwatches = (offset: number) =>
  h(
    "div",
    { class: "swatches" },
    ...bucketLabels
      .slice(offset)
      .map((label, position) =>
        h("span", { class: "swatch" }, swatch(position + offset === 0 ? "--cc-none" : `--cc-${position + offset}`), label),
      ),
  );

const sideSwatches = () =>
  h(
    "div",
    { class: "swatches" },
    ...data()
      .lanes.filter((lane) => !traySides.includes(lane.side) || state.map.tray.has(lane.side) || state.tab === "all")
      .map((lane) => h("span", { class: "swatch" }, swatch(`--side-${lane.side}`), lane.label)),
  );

const helpDetails = (title: string, ...paragraphs: string[]) =>
  h("details", {}, h("summary", {}, title), ...paragraphs.map((text) => h("p", {}, text)));

const complexityHelp = () =>
  helpDetails(
    "How CC is counted",
    "Classic cyclomatic complexity, like ESLint's complexity rule. Each function starts at 1 and gets +1 for every if, for, for…in, for…of, while, do…while, catch, ?:, non-default case, &&, ||, ??, logical assignment, default value and optional chain (?.).",
    "Nested functions are scored on their own. Top-level module code and Svelte markup are not measured. A high score means a function is worth reading closely, not that it is wrong.",
  );

const placementHelp = () =>
  helpDetails(
    "How sides and areas are found",
    data().framework === "sveltekit"
      ? "Sides follow SvelteKit's rules: starting from the files SvelteKit loads itself (routes, hooks), files reached only from components, universal loads and client hooks are client bundle; files reached only from server routes and hooks are server only; files reached from both are shared. $lib/server and *.server.* files are always server only."
      : "No SvelteKit app was found, so source files share one side. Tests and config have their own sides.",
    "Areas are groups of files that import each other much more than they import the rest of the project (community detection on the import graph, with a small bonus for files in the same folder). Each area is named after the folder that holds most of its files.",
  );

const renderLegend = () => {
  if (!state.snapshot) return;
  const colorRows =
    state.color === "side"
      ? [h("div", {}, "Color: side"), sideSwatches()]
      : [h("div", {}, "Color: highest function CC"), complexitySwatches(0)];
  const content =
    state.tab === "map"
      ? [
          legendRow(h("span", { class: "card-swatch" }), "Card: a part of the project · number on an arrow = imports"),
          legendRow(h("span", { class: "card-swatch stub-swatch" }), "Dashed card: outside this view"),
          legendRow(h("span", { class: "dot diamond" }), "Entry point"),
          legendRow(h("span", { class: "dot ring" }), "Red border: contains an import cycle"),
          legendRow(swatch("--edge-strong", "line"), "Uses (outgoing)"),
          legendRow(swatch("--edge-in", "line"), "Used by (incoming)"),
          ...colorRows,
          placementHelp(),
          complexityHelp(),
        ]
      : state.tab === "routes"
        ? [
            h("div", {}, "Left column: client side. Right column: server side."),
            h("div", {}, "Top: route files · next: their direct imports · cards: everything reached further down."),
            ...colorRows,
          ]
        : state.tab === "all"
          ? [
              legendRow(h("span", { class: "dot diamond" }), "Entry point"),
              legendRow(swatch("--group-edge", "line"), "Imports between folders (thicker = more)"),
              legendRow(swatch("--edge-strong", "line"), "Selected file imports it"),
              legendRow(swatch("--edge-in", "line"), "It imports the selected file"),
              legendRow(h("span", { class: "dot ring" }), "Part of an import cycle"),
              ...colorRows,
              placementHelp(),
              complexityHelp(),
            ]
          : state.tab === "logic"
            ? [
                legendRow(h("span", { class: "shape-swatch decision" }), "Decision (if, while, switch)"),
                legendRow(h("span", { class: "shape-swatch loop" }), "Loop"),
                legendRow(h("span", { class: "shape-swatch block" }), "Steps run in order (code preview)"),
                legendRow(h("span", { class: "shape-swatch exit-return" }), "Return"),
                legendRow(h("span", { class: "shape-swatch exit-throw" }), "Throw or catch"),
                legendRow(swatch("--edge-in", "line"), "true / each item"),
                legendRow(swatch("--flow-false", "line"), "false / done"),
                legendRow(h("span", { class: "line dashed" }), "Back to the loop, break or continue"),
                h("div", {}, "CC +N on a step: how much it adds to the function's complexity."),
              ]
            : [
              legendRow(swatch("--edge-strong", "line"), "Selected function calls it"),
              legendRow(swatch("--edge-in", "line"), "It calls the selected function"),
              h("div", {}, "Fill: function CC"),
              complexitySwatches(1),
              complexityHelp(),
            ];
  const open = elements.legend.querySelector("details")?.open ?? true;
  elements.legend.replaceChildren(h("details", { open }, h("summary", {}, "Legend"), h("div", { class: "rows" }, ...content)));
};

const renderDetails = () => {
  if (!state.snapshot) return;
  const ctx = panelContext();
  const set = (content: HTMLElement[]) => elements.details.replaceChildren(...content);
  if (state.tab === "map") {
    const view = state.map.view;
    const selected = state.map.selected;
    if (state.map.path) {
      return set(
        selected?.startsWith("module:")
          ? modulePanel(ctx, selected, { label: "← Back to path", run: () => selectIn("map", null) })
          : pathPanel(ctx, state.map.path, () => openMapNode(state.map.node)),
      );
    }
    if (selected?.startsWith("link:") && view) {
      const mapLink = view.links.find((candidate) => candidate.id === selected);
      if (mapLink) return set(linkPanel(ctx, mapLink, view));
    }
    if (selected?.startsWith("module:")) return set(modulePanel(ctx, selected, null));
    if (selected && view) {
      const item = view.items.find((candidate) => candidate.id === selected);
      const node = item?.target ? tree().nodes.get(item.target) : undefined;
      if (item && node) return set(nodePanel(ctx, node, item, view, false));
    }
    const node = tree().nodes.get(state.map.node);
    return set(!node || node.kind === "root" ? overviewPanel(ctx) : nodePanel(ctx, node, null, view, true));
  }
  if (state.tab === "routes") {
    const route = state.routes.selected ? index().routes.get(state.routes.selected) : undefined;
    const view = state.routes.view;
    if (!route || !view) return set(routesListPanel(ctx, state.routes.filter, (value) => (state.routes.filter = value)));
    const item = state.routes.item ? view.items.find((candidate) => candidate.id === state.routes.item) : undefined;
    if (item) return set(routeItemPanel(ctx, item, () => selectIn("routes", null)));
    return set(routePanel(ctx, route, view));
  }
  if (state.tab === "all") {
    const selected = state.all.selected;
    if (selected?.startsWith("imports:")) return set(importEdgePanel(ctx, ...splitEdgeId(selected, "imports:")));
    if (selected?.startsWith("folders:")) return set(folderEdgePanel(ctx, ...splitEdgeId(selected, "folders:")));
    if (selected?.startsWith("group:")) return set(folderPanel(ctx, selected));
    return set(selected ? modulePanel(ctx, selected, null) : overviewPanel(ctx));
  }
  if (state.tab === "logic" && state.logic.data) {
    return set(
      logicPanel(ctx, state.logic.data, state.logic.selected, {
        select: (id) => selectIn("logic", id),
        toggle: toggleLogic,
        expandAll: () => {
          state.logic.collapsed = new Set();
          renderLogicGraph(true);
          refresh();
        },
        collapseBranches: () => {
          state.logic.collapsed = new Set(
            (state.logic.data?.nodes ?? []).filter((node) => structuralKinds.has(node.kind) && node.region !== null).map((node) => node.id),
          );
          state.logic.selected = null;
          renderLogicGraph(true);
          refresh();
        },
        collapsed: state.logic.collapsed,
      }),
    );
  }
  const selected = state.functions.selected;
  if (selected?.startsWith("calls:")) return set(callEdgePanel(ctx, ...splitEdgeId(selected, "calls:")));
  if (selected) return set(functionPanel(ctx, selected));
  return set(state.functions.explored ? functionsOverviewPanel(ctx, state.functions.explored) : overviewPanel(ctx));
};

const renderLayoutOptions = () => {
  const options: [string, string][] =
    state.tab === "all"
      ? [
          ["structure", "Structure layout"],
          ["force", `Force layout (up to ${forceLayoutLimit} files)`],
        ]
      : [
          ["cose", "Force layout"],
          ["breadthfirst", "Layered layout"],
        ];
  elements.layout.replaceChildren(...options.map(([value, label]) => h("option", { value }, label)));
  elements.layout.value = state.tab === "all" ? state.all.layout : state.functions.layout;
};

const updateToolbar = () => {
  const activeTab = state.tab === "logic" ? "functions" : state.tab;
  (Object.keys(elements.tabs) as (keyof typeof elements.tabs)[]).forEach((tab) => {
    elements.tabs[tab].classList.toggle("active", activeTab === tab);
    elements.tabs[tab].setAttribute("aria-selected", String(activeTab === tab));
  });
  elements.tabs.functions.disabled = state.functions.explored === null;
  elements.tabs.functions.textContent = state.tab === "logic" ? "Functions › Logic" : "Functions";
  elements.tabs.routes.disabled = (state.snapshot?.routes.length ?? 0) === 0;
  elements.tabControls.forEach((control) => {
    control.hidden = !(control.dataset.tabs ?? "").split(" ").includes(state.tab);
  });
  const focusable = state.tab === "all" ? state.all : state.functions;
  elements.focus.disabled = currentSelection(state.tab) === null;
  elements.focus.checked = focusable.focus;
  elements.grouping.value = state.map.grouping;
  elements.color.value = state.color;
  elements.rescan.disabled = state.scanning;
  elements.rescan.textContent = state.scanning ? "Scanning…" : "Rescan";
  renderLayoutOptions();
};

const updateEmptyState = () => {
  if (!state.snapshot) return showEmpty("Loading…");
  if (data().modules.length === 0) return showEmpty(`No .js, .jsx, .ts, .tsx or .svelte files found in ${data().root}.`);
  if (state.tab === "routes" && !state.routes.selected) return showEmpty("Pick a route from the list on the right.");
  if (state.tab === "all" && state.cy.all && state.cy.all.nodes(".file").not(".hidden").empty()) {
    return showEmpty("No import cycles found.");
  }
  if (state.tab === "functions") {
    const module = state.functions.explored ? index().modules.get(state.functions.explored) : undefined;
    if (module && module.functionIds.length === 0) {
      return showEmpty("No functions are declared in this file. Top-level code and Svelte markup are not measured.");
    }
  }
  if (state.tab === "map" && state.map.view && state.map.view.items.length === 0) return showEmpty("Nothing to show here.");
  return showEmpty(null);
};

const refresh = () => {
  updateToolbar();
  renderCrumbs();
  renderDetails();
  renderLegend();
  updateEmptyState();
};

const renderDiagnostics = () => {
  const diagnostics = data().diagnostics;
  elements.warnings.textContent = plural(diagnostics.length, "warning");
  elements.warnings.classList.toggle("has-warnings", diagnostics.length > 0);
  elements.diagnosticsList.replaceChildren(
    ...(diagnostics.length === 0
      ? [h("li", { class: "note" }, "No warnings. Every file parsed and every local import resolved.")]
      : diagnostics.map((diagnostic) =>
          h(
            "li",
            {},
            h("span", { class: "diagnostic-kind" }, diagnostic.kind),
            h(
              "button",
              { class: "link", onClick: () => revealModule(moduleIdOf(diagnostic.file)) },
              diagnostic.line ? `${diagnostic.file}:${diagnostic.line}` : diagnostic.file,
            ),
            h("span", {}, diagnostic.message),
          ),
        )),
  );
};

const setSnapshot = (snapshot: GraphSnapshot) => {
  state.snapshot = snapshot;
  state.index = buildIndex(snapshot);
  rebuildTree();
  document.title = `${snapshot.name} · Laqueus`;
  elements.projectName.textContent = snapshot.name;
  elements.scanInfo.textContent = `Scanned ${new Date(snapshot.scannedAt).toLocaleTimeString()} in ${snapshot.durationMs} ms`;
  renderDiagnostics();
  state.cy.all?.destroy();
  state.cy.all = null;
  state.all.moved = false;
  if (state.map.path && state.map.path.some((id) => !index().modules.has(id))) state.map.path = null;
  if (state.routes.selected && !index().routes.has(state.routes.selected)) state.routes.selected = null;
  if (state.functions.explored && !index().modules.has(state.functions.explored)) {
    state.functions.explored = null;
    state.cy.functions?.destroy();
    state.cy.functions = null;
    if (state.tab === "functions") state.tab = state.previousTab;
  }
};

const applyHash = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  state.applyingHash = true;
  state.map.grouping = params.get("group") === "folders" ? "folders" : "areas";
  state.color = params.get("color") === "complexity" ? "complexity" : "side";
  state.map.tray = new Set(
    (params.get("tray") ?? "").split(",").filter((side): side is Side => traySides.includes(side as Side)),
  );
  syncTrayInputs();
  rebuildTree();
  const tab = (["map", "routes", "all", "functions", "logic"] as const).find((candidate) => candidate === params.get("tab")) ?? "map";
  const file = params.get("file");
  const logicId = params.get("logic");
  if (tab === "logic" && logicId) {
    state.applyingHash = false;
    void openLogic(logicId, params.get("step"), false);
    return;
  }
  if (tab === "functions" && file) exploreFunctions(file, params.get("fn"));
  else if (tab === "routes") {
    openRoute(params.get("route"));
    if (params.get("item")) selectIn("routes", params.get("item"));
  } else if (tab === "all") openAllFiles(params.get("sel"));
  else {
    const path = params.get("path")?.split("|");
    if (path && path.length === 2) openPath(path[0] as string, path[1] as string);
    else openMapNode(params.get("node") ?? "root", params.get("sel"));
  }
  state.applyingHash = false;
  writeHash(false);
};

const rescan = async () => {
  if (state.scanning) return;
  state.scanning = true;
  updateToolbar();
  const response = await fetch("/api/rescan", { method: "POST" }).catch(() => null);
  if (!response) {
    toast("Rescan failed: the server is not reachable. Showing the previous scan.", true);
  } else if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    toast(`Rescan failed: ${body.error ?? response.statusText}. Showing the previous scan.`, true);
  } else {
    setSnapshot((await response.json()) as GraphSnapshot);
    state.applyingHash = true;
    if (state.tab === "map") renderMapGraph();
    if (state.tab === "routes") renderRoutesGraph();
    if (state.tab === "all") ensureAllGraph();
    if (state.tab === "functions" && state.functions.explored) {
      const explored = state.functions.explored;
      const selected = state.functions.selected;
      state.cy.functions?.destroy();
      state.cy.functions = null;
      exploreFunctions(explored, selected && index().functions.has(selected) ? selected : null);
    }
    state.applyingHash = false;
    if (state.tab === "logic" && state.logic.functionId) {
      if (index().functions.has(state.logic.functionId)) await openLogic(state.logic.functionId, null, false);
      else exploreFunctions(state.functions.explored ?? "", null);
    }
    refresh();
    toast("Rescan complete");
  }
  state.scanning = false;
  updateToolbar();
};

const bestSideNode = (areaId: string) =>
  [...tree().nodes.values()]
    .filter((node) => node.area?.id === areaId)
    .sort((a, b) => b.moduleIds.length - a.moduleIds.length)[0]?.id;

const searchHits = (query: string): SearchHit[] => {
  const needle = query.trim().toLowerCase();
  if (!needle || !state.snapshot) return [];
  const rank = (text: string) => (text.toLowerCase().startsWith(needle) ? 0 : 1);
  const multipleApps = new Set(data().routes.map((route) => route.app)).size > 1;
  const files = data()
    .modules.filter((module) => module.path.toLowerCase().includes(needle))
    .sort((a, b) => rank(basename(a.path)) - rank(basename(b.path)) || a.path.length - b.path.length)
    .slice(0, 7)
    .map((module) => ({ label: basename(module.path), detail: module.path, run: () => revealModule(module.id) }));
  const areas = data()
    .areas.filter((area) => area.label.toLowerCase().includes(needle))
    .slice(0, 4)
    .flatMap((area) => {
      const node = bestSideNode(area.id);
      return node
        ? [{ label: area.label, detail: `Area · ${plural(area.moduleIds.length, "file")}`, run: () => openMapNode(node) }]
        : [];
    });
  const routes = data()
    .routes.filter((route) => routeLabel(route, multipleApps).toLowerCase().includes(needle))
    .slice(0, 4)
    .map((route) => ({ label: routeLabel(route, multipleApps), detail: `Route · ${route.directory}`, run: () => openRoute(route.id) }));
  const folders = data()
    .groups.filter((group) => group.directory.toLowerCase().includes(needle))
    .sort((a, b) => a.directory.length - b.directory.length)
    .slice(0, 3)
    .map((group) => ({
      label: `${folderLabel(group)}/`,
      detail: `Folder in All files · ${index().lanes.get(group.side)?.label ?? group.side}`,
      run: () => openAllFiles(group.id),
    }));
  const functions = data()
    .functions.filter((fn) => fn.name.toLowerCase().includes(needle))
    .sort((a, b) => rank(a.name) - rank(b.name) || b.complexity - a.complexity)
    .slice(0, 6)
    .map((fn) => ({
      label: `${fn.name} · CC ${fn.complexity}`,
      detail: lineRef(fn.location),
      run: () => exploreFunctions(fn.moduleId, fn.id),
    }));
  return [...files, ...areas, ...routes, ...folders, ...functions];
};

const runHit = (hit: SearchHit) => {
  elements.search.value = "";
  elements.searchResults.hidden = true;
  elements.search.blur();
  hit.run();
};

const renderSearchResults = () => {
  const hits = state.searchHits;
  elements.searchResults.hidden = elements.search.value.trim() === "";
  elements.searchResults.replaceChildren(
    ...(hits.length === 0
      ? [h("li", { class: "note" }, "No matching files, areas, routes, folders or functions.")]
      : hits.map((hit, position) =>
          h(
            "li",
            {},
            h(
              "button",
              {
                class: position === state.activeHit ? "active" : "",
                onMousedown: (event) => event.preventDefault(),
                onClick: () => runHit(hit),
              },
              h("span", {}, hit.label),
              h("small", {}, hit.detail),
            ),
          ),
        )),
  );
};

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;

const wireToolbar = () => {
  (Object.keys(elements.graphs) as Tab[]).forEach((tab) => wheelZoom(elements.graphs[tab], () => state.cy[tab]));
  elements.tabs.map.addEventListener("click", () => openMapNode(state.map.node, state.map.selected));
  elements.tabs.routes.addEventListener("click", () => openRoute(state.routes.selected));
  elements.tabs.all.addEventListener("click", () => openAllFiles(state.all.selected));
  elements.tabs.functions.addEventListener("click", () => {
    if (state.functions.explored) exploreFunctions(state.functions.explored, state.functions.selected);
  });
  elements.grouping.addEventListener("change", () => {
    state.map.grouping = elements.grouping.value === "folders" ? "folders" : "areas";
    const side = tree().nodes.get(state.map.node)?.side;
    rebuildTree();
    openMapNode(side ? `side:${side}` : "root");
  });
  elements.color.addEventListener("change", () => {
    state.color = elements.color.value === "complexity" ? "complexity" : "side";
    Object.values(state.cy).forEach((cy) => cy?.style(graphStyle(state.color)));
    refresh();
    writeHash(false);
  });
  elements.trayInputs.forEach((input) =>
    input.addEventListener("change", () => {
      const side = input.dataset.tray as Side;
      if (input.checked) state.map.tray.add(side);
      else state.map.tray.delete(side);
      rebuildTree();
      openMapNode(state.map.node, state.map.selected);
    }),
  );
  elements.fit.addEventListener("click", () => {
    const cy = state.cy[state.tab];
    if (cy) fitVisible(cy);
  });
  elements.rescan.addEventListener("click", () => void rescan());
  elements.layout.addEventListener("change", () => {
    if (state.tab === "all") {
      state.all.layout = elements.layout.value === "force" ? "force" : "structure";
      refreshAllGraph(true);
    } else {
      state.functions.layout = elements.layout.value === "breadthfirst" ? "breadthfirst" : "cose";
      const cy = state.cy.functions;
      if (cy) runForceLayout(cy, state.functions.layout === "breadthfirst");
    }
  });
  elements.cyclesOnly.addEventListener("change", () => {
    refreshAllGraph(true);
    updateEmptyState();
  });
  elements.focus.addEventListener("change", () => {
    if (state.tab === "all") {
      state.all.focus = elements.focus.checked;
      refreshAllGraph(true);
    } else if (state.tab === "functions") {
      state.functions.focus = elements.focus.checked;
      refreshFunctionGraph(true);
    }
    updateEmptyState();
  });
  elements.warnings.addEventListener("click", () => {
    elements.diagnostics.hidden = !elements.diagnostics.hidden;
    elements.warnings.setAttribute("aria-expanded", String(!elements.diagnostics.hidden));
    state.cy[state.tab]?.resize();
  });
  elements.closeDiagnostics.addEventListener("click", () => {
    elements.diagnostics.hidden = true;
    elements.warnings.setAttribute("aria-expanded", "false");
  });
  elements.search.addEventListener("input", () => {
    state.searchHits = searchHits(elements.search.value);
    state.activeHit = 0;
    renderSearchResults();
  });
  elements.search.addEventListener("keydown", (event) => {
    const count = state.searchHits.length;
    if (event.key === "ArrowDown" && count > 0) state.activeHit = (state.activeHit + 1) % count;
    else if (event.key === "ArrowUp" && count > 0) state.activeHit = (state.activeHit - 1 + count) % count;
    else if (event.key === "Enter" && state.searchHits[state.activeHit]) {
      return runHit(state.searchHits[state.activeHit] as SearchHit);
    } else if (event.key === "Escape") {
      elements.search.value = "";
      elements.searchResults.hidden = true;
      return;
    } else return;
    event.preventDefault();
    renderSearchResults();
  });
  elements.search.addEventListener("blur", () => (elements.searchResults.hidden = true));
  elements.search.addEventListener("focus", () => {
    if (elements.search.value.trim() !== "") renderSearchResults();
  });
  document.addEventListener("keydown", (event) => {
    if (isTyping(event.target)) return;
    if (event.key === "/") {
      event.preventDefault();
      elements.search.focus();
    } else if (event.key === "Escape") {
      if (currentSelection(state.tab)) selectIn(state.tab, null);
      else goUp();
    } else if (event.key === "Backspace") {
      event.preventDefault();
      goUp();
    } else if (event.key === "Enter" && state.tab === "map" && state.map.selected) {
      openItem(state.map.selected);
    }
  });
  window.addEventListener("popstate", () => {
    if (state.snapshot) applyHash();
  });
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => Object.values(state.cy).forEach((cy) => cy?.style(graphStyle(state.color))));
};

const start = async () => {
  wireToolbar();
  showEmpty("Loading…");
  const response = await fetch("/api/graph").catch(() => null);
  if (!response?.ok) {
    showEmpty("Could not load the graph. Is laqueus still running?");
    return;
  }
  setSnapshot((await response.json()) as GraphSnapshot);
  applyHash();
};

void start();
