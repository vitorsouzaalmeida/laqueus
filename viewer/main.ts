import { type FunctionLogic, type GraphSnapshot, type Point, type Side, moduleId as moduleIdOf } from "../src/model";
import { type Index, buildIndex, lineRef, routeLabel } from "./data";
import { basename, byId, h, plural } from "./dom";
import { defaultCollapsed, flowPositions, flowView, structuralKinds } from "./flow";
import { forceLayoutAsync } from "./force-async";
import { type ColorMode, type FunctionLayout, bucketLabels, mapPositions, sidesPositions } from "./graph";
import { type Centers, type GraphView, createGraphView } from "./graph-view.svelte";
import { layered } from "./layered";
import { functionsLook, neighbourhoodLook, pathLook } from "./looks";
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
  isTraySide,
  pathView,
  shortestPath,
  traySides,
  viewMode,
} from "./map";
import {
  type PanelContext,
  callEdgePanel,
  functionPanel,
  functionsOverviewPanel,
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
import type { Scene } from "./scene";
import { flowScene, functionScene, mapScene } from "./scenes";

const tabs = ["map", "routes", "functions", "logic"] as const;

type Tab = (typeof tabs)[number];
type SearchHit = { label: string; detail: string; run: () => void };

const elements = {
  projectName: byId("project-name", HTMLElement),
  tabs: {
    map: byId("tab-map", HTMLButtonElement),
    routes: byId("tab-routes", HTMLButtonElement),
    functions: byId("tab-functions", HTMLButtonElement),
  },
  graphs: {
    map: byId("map-graph", HTMLElement),
    routes: byId("routes-graph", HTMLElement),
    functions: byId("functions-graph", HTMLElement),
    logic: byId("logic-graph", HTMLElement),
  },
  search: byId("search", HTMLInputElement),
  searchResults: byId("search-results", HTMLUListElement),
  grouping: byId("grouping", HTMLSelectElement),
  color: byId("color", HTMLSelectElement),
  focus: byId("focus", HTMLInputElement),
  layout: byId("layout", HTMLSelectElement),
  fit: byId("fit", HTMLButtonElement),
  rescan: byId("rescan", HTMLButtonElement),
  warnings: byId("warnings", HTMLButtonElement),
  crumbs: byId("crumbs", HTMLElement),
  empty: byId("empty", HTMLElement),
  legend: byId("legend", HTMLElement),
  toast: byId("toast", HTMLElement),
  details: byId("details", HTMLElement),
  diagnostics: byId("diagnostics", HTMLElement),
  diagnosticsList: byId("diagnostics-list", HTMLUListElement),
  closeDiagnostics: byId("close-diagnostics", HTMLButtonElement),
  trayInputs: [...document.querySelectorAll<HTMLInputElement>("input[data-tray]")],
  tabControls: [...document.querySelectorAll<HTMLElement>("[data-tabs]")],
};

type State = {
  /** Null until the first snapshot arrives; the three always change together. */
  loaded: { snapshot: GraphSnapshot; index: Index; tree: Tree } | null;
  tab: Tab;
  previousTab: Tab;
  color: ColorMode;
  map: {
    node: string;
    selected: string | null;
    grouping: Grouping;
    tray: Set<Side>;
    path: string[] | null;
    view: MapView | null;
  };
  routes: { selected: string | null; item: string | null; filter: string; view: RouteView | null };
  functions: {
    explored: string | null;
    selected: string | null;
    focus: boolean;
    layout: FunctionLayout;
    positions: Map<string, Point> | null;
    scene: Scene | null;
  };
  logic: { functionId: string | null; data: FunctionLogic | null; selected: string | null; collapsed: Set<string> };
  pathPickerFrom: string | null;
  scanning: boolean;
  searchHits: SearchHit[];
  activeHit: number;
  applyingHash: boolean;
};

const state: State = {
  loaded: null,
  tab: "map",
  previousTab: "map",
  color: "side",
  map: { node: "root", selected: null, grouping: "areas", tray: new Set(), path: null, view: null },
  routes: { selected: null, item: null, filter: "", view: null },
  functions: { explored: null, selected: null, focus: false, layout: "cose", positions: null, scene: null },
  logic: { functionId: null, data: null, selected: null, collapsed: new Set() },
  pathPickerFrom: null,
  scanning: false,
  searchHits: [],
  activeHit: 0,
  applyingHash: false,
};

const loaded = () => {
  if (!state.loaded) throw new Error("The graph has not loaded yet");
  return state.loaded;
};
const data = () => loaded().snapshot;
const index = () => loaded().index;
const tree = () => loaded().tree;

let toastTimer: number | undefined;
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
  if (state.applyingHash || !state.loaded) return;

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
      : tab === "logic"
        ? state.logic.selected
        : state.functions.selected;

const containerOf = (tab: Tab) => elements.graphs[tab];

const sceneHas = (scene: Scene, id: string) =>
  scene.nodes.some((node) => node.id === id) || scene.edges.some((edge) => edge.id === id);

/** Files open their functions; cards open their part of the map. */
const openViewItem = (view: MapView | null, id: string) => {
  const item = view?.items.find((candidate) => candidate.id === id);
  const [moduleId] = item?.moduleIds ?? [];

  if (item?.kind === "file" && moduleId) exploreFunctions(moduleId);
  else if (item?.target) openMapNode(item.target);
};

const toggleStructural = (id: string) => {
  const owner = id.startsWith("collapsed:") ? id.slice("collapsed:".length) : id;
  const node = state.logic.data?.nodes.find((candidate) => candidate.id === owner);

  if (node && structuralKinds.has(node.kind)) toggleLogic(owner);
};

const graphs: Record<Tab, GraphView> = {
  map: createGraphView(containerOf("map"), {
    select: (id) => selectIn("map", id),
    open: (id) => openViewItem(state.map.view, id),
  }),
  routes: createGraphView(containerOf("routes"), {
    select: (id) => selectIn("routes", id),
    open: (id) => openViewItem(state.routes.view, id),
  }),
  functions: createGraphView(containerOf("functions"), {
    select: (id) => selectIn("functions", id),
    open: (id) => void openLogic(id),
  }),
  logic: createGraphView(containerOf("logic"), {
    select: (id) => selectIn("logic", id),
    open: (id) => toggleStructural(id),
  }),
};

const mapView = (): MapView =>
  state.map.path ? pathView(data(), state.map.path) : buildView(data(), tree(), state.map.node);

const renderMapGraph = (center: string | null = null) => {
  const view = mapView();
  state.map.view = view;

  const positions =
    !state.map.path && state.map.node === "root"
      ? sidesPositions(view.items, new Set(traySides))
      : mapPositions(view, 1);
  const scene = mapScene(view);

  if (state.map.selected && !sceneHas(scene, state.map.selected)) state.map.selected = null;

  graphs.map.show({
    scene,
    centers: positions,
    selected: state.map.selected,
    color: state.color,
    look: (focus) => neighbourhoodLook(scene, focus),
    hover: true,
    placement: center ? { center } : "fit",
  });
};

const renderRoutesGraph = () => {
  const route = state.routes.selected ? index().routes.get(state.routes.selected) : undefined;

  if (!route) {
    state.routes.view = null;
    graphs.routes.clear();
    return;
  }

  const view = buildRouteView(data(), tree(), route);
  state.routes.view = view;

  const scene = mapScene(view);

  if (state.routes.item && !sceneHas(scene, state.routes.item)) state.routes.item = null;

  graphs.routes.show({
    scene,
    centers: mapPositions(view, 2),
    selected: state.routes.item,
    color: state.color,
    look: (focus) => neighbourhoodLook(scene, focus),
    hover: true,
    placement: "fit",
  });
};

const functionsFocusMode = (scene: Scene) =>
  state.functions.focus && state.functions.selected !== null && sceneHas(scene, state.functions.selected);

const visibleFunctions = (scene: Scene): Set<string> => {
  const look = functionsLook(scene, null, state.functions.selected, functionsFocusMode(scene));
  return new Set(scene.nodes.filter((node) => !look.hidden.has(node.id)).map((node) => node.id));
};

const functionCenters = (scene: Scene, visible: ReadonlySet<string>): Centers => {
  const nodes = scene.nodes.filter((node) => visible.has(node.id));
  const links = scene.edges
    .filter((edge) => visible.has(edge.source) && visible.has(edge.target))
    .map((edge) => ({ from: edge.source, to: edge.target }));

  return state.functions.layout === "breadthfirst"
    ? layered(
        nodes.map((node) => ({ id: node.id, width: 160, height: 44 })),
        links,
        { maxPerRow: 8, gapX: 30, gapY: 70 },
      )
    : forceLayoutAsync(
        nodes.map((node) => ({ id: node.id })),
        links,
      );
};

const refreshFunctionGraph = (relayout: boolean) => {
  const scene = state.functions.scene;

  if (!scene) return;

  const id = state.functions.selected;
  const selected = id && sceneHas(scene, id) ? id : null;
  const focusMode = functionsFocusMode(scene);

  graphs.functions.update({ selected, look: (focus) => functionsLook(scene, focus, selected, focusMode) });

  if (!relayout) return;

  if (focusMode) {
    state.functions.positions ??= graphs.functions.positions();
    graphs.functions.relayout(functionCenters(scene, visibleFunctions(scene)));
  } else if (state.functions.positions) {
    graphs.functions.relayout(state.functions.positions);
    state.functions.positions = null;
  }
};

const showTab = (tab: Tab) => {
  if (tab !== "functions" && tab !== "logic") state.previousTab = tab;
  state.tab = tab;

  tabs.forEach((name) => {
    elements.graphs[name].hidden = name !== tab;
  });
};

const selectIn = (tab: Tab, id: string | null) => {
  if (tab === "map") {
    state.map.selected = id;
    graphs.map.select(id);
  } else if (tab === "routes") {
    state.routes.item = id;
    graphs.routes.select(id);
  } else if (tab === "logic") {
    state.logic.selected = id;
    graphs.logic.select(id);
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

  const node = tree().nodes.get(state.map.node);

  renderMapGraph(selected && node && viewMode(node) === "files" ? selected : null);
  refresh();
  writeHash(true);
};

const mapOptions = () => ({ grouping: state.map.grouping, tray: state.map.tray });

const rebuildTree = () => {
  const current = loaded();

  current.tree = buildTree(current.snapshot, mapOptions());
  if (!current.tree.nodes.has(state.map.node)) state.map.node = "root";
};

const syncTrayInputs = () =>
  elements.trayInputs.forEach((input) => {
    const side = input.dataset.tray;
    input.checked = isTraySide(side) && state.map.tray.has(side);
  });

const revealModule = (moduleId: string) => {
  const module = index().modules.get(moduleId);

  if (!module) return;

  if (!tree().pathOf.has(moduleId) && traySides.includes(module.placement.side)) {
    state.map.tray.add(module.placement.side);
    syncTrayInputs();
    rebuildTree();
  }

  openMapNode(deepestNode(tree(), moduleId) ?? "root", moduleId);
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

  const sameModule = state.functions.explored === moduleId && graphs.functions.mounted;

  showTab("functions");
  state.functions.explored = moduleId;

  if (!sameModule) {
    state.functions.selected = null;
    state.functions.focus = false;
    state.functions.positions = null;

    const functions = module.functionIds.flatMap((id) => index().functions.get(id) ?? []);
    const scene = functionScene(functions, (id) => index().callsFrom.get(id) ?? []);
    state.functions.scene = scene;

    graphs.functions.show({
      scene,
      centers: functionCenters(scene, new Set(scene.nodes.map((node) => node.id))),
      selected: null,
      color: state.color,
      look: (focus) => functionsLook(scene, focus, null, false),
      hover: true,
      placement: "fit",
    });
  }

  state.functions.selected = functionId ?? (sameModule ? state.functions.selected : null);
  refreshFunctionGraph(false);
  if (functionId) graphs.functions.center(functionId);

  refresh();
  writeHash(true);
};

const renderLogicGraph = (refit: boolean) => {
  const logic = state.logic.data;

  if (!logic) return;

  const viewport = !refit && graphs.logic.mounted ? graphs.logic.viewport() : null;
  const view = flowView(logic, state.logic.collapsed);
  const scene = flowScene(view);

  if (state.logic.selected && !sceneHas(scene, state.logic.selected)) state.logic.selected = null;

  const start = view.items.find((item) => item.kind === "start");

  graphs.logic.show({
    scene,
    centers: flowPositions(view),
    selected: state.logic.selected,
    color: state.color,
    look: (focus) => pathLook(scene, focus),
    hover: false,
    placement: viewport ? { viewport } : start ? { top: start.id } : "fit",
  });
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

/** The server's error body, when it sent one. */
const errorOf = async (response: Response): Promise<string> => {
  const body: unknown = await response.json().catch(() => null);
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;

  return typeof error === "string" ? error : response.statusText;
};

const openLogic = async (functionId: string, step: string | null = null, push = true) => {
  const fn = index().functions.get(functionId);

  if (!fn) return;

  const key = `${data().scannedAt}|${functionId}`;
  const cached = logicCache.get(key);
  const response = cached ? null : await fetch(`/api/logic?fn=${encodeURIComponent(functionId)}`).catch(() => null);
  // The server shares its types through src/model.
  const logic = cached ?? (response?.ok ? ((await response.json()) as FunctionLogic) : null);

  if (!logic) {
    const reason = response ? await errorOf(response) : "the server is not reachable";
    toast(`Could not load the logic of ${fn.name}: ${reason}.`, true);
    return;
  }

  logicCache.set(key, logic);
  state.functions.explored = fn.moduleId;
  state.functions.selected = functionId;
  state.logic.functionId = functionId;
  state.logic.data = logic;
  state.logic.selected = step;
  state.logic.collapsed = defaultCollapsed(logic);

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
    if (state.previousTab === "routes") openRoute(state.routes.selected);
    else openMapNode(state.map.node, state.map.selected);
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
  if (!state.loaded) return;

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
    const count = node
      ? mode === "cards"
        ? plural(node.children.length, "part")
        : plural(node.moduleIds.length, "file")
      : "";

    elements.crumbs.replaceChildren(
      h(
        "div",
        {},
        ...trail.flatMap((item, position) =>
          [
            position > 0 ? separator() : null,
            crumb(
              item.label,
              position === trail.length - 1 ? null : () => openMapNode(item.id, trail[position + 1]?.id ?? null),
            ),
          ].filter((part): part is HTMLElement => part !== null),
        ),
        h("span", { class: "muted" }, ` · ${count}`),
      ),
      ...(mode === "cards"
        ? [
            hintLine(
              "Double-click a card (or select it and press Enter) to open it · Backspace goes up · Hover to see what it uses",
            ),
          ]
        : []),
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
      hintLine(
        "Select a step to highlight every path through it · Double-click a decision, loop or try to fold it · Backspace goes back",
      ),
    );

    return;
  }

  elements.crumbs.replaceChildren(
    h("div", {}, h("button", { onClick: goUp }, "← Back"), " ", h("span", { class: "mono" }, module?.path ?? "")),
    hintLine(
      "Functions declared in this file. Arrows are calls written inside the file. Double-click a function to see its logic.",
    ),
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
        h(
          "span",
          { class: "swatch" },
          swatch(position + offset === 0 ? "--cc-none" : `--cc-${position + offset}`),
          label,
        ),
      ),
  );

const sideSwatches = () =>
  h(
    "div",
    { class: "swatches" },
    ...data()
      .lanes.filter((lane) => !traySides.includes(lane.side) || state.map.tray.has(lane.side))
      .map((lane) => h("span", { class: "swatch" }, swatch(`--side-${lane.side}`), lane.label)),
  );

const renderLegend = () => {
  if (!state.loaded) return;

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
        ]
      : state.tab === "routes"
        ? [
            h("div", {}, "Left column: client side. Right column: server side."),
            h("div", {}, "Top: route files · next: their direct imports · cards: everything reached further down."),
            ...colorRows,
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
            ];
  const open = elements.legend.querySelector("details")?.open ?? true;

  elements.legend.replaceChildren(
    h("details", { open }, h("summary", {}, "Legend"), h("div", { class: "rows" }, ...content)),
  );
};

const showDetails = (content: HTMLElement[]) => elements.details.replaceChildren(...content);

const renderDetails = () => {
  if (!state.loaded) return;

  const ctx = panelContext();

  if (state.tab === "map") {
    const view = state.map.view;
    const selected = state.map.selected;

    if (state.map.path) {
      return showDetails(
        selected?.startsWith("module:")
          ? modulePanel(ctx, selected, { label: "← Back to path", run: () => selectIn("map", null) })
          : pathPanel(ctx, state.map.path, () => openMapNode(state.map.node)),
      );
    }

    if (selected?.startsWith("link:") && view) {
      const mapLink = view.links.find((candidate) => candidate.id === selected);
      if (mapLink) return showDetails(linkPanel(ctx, mapLink, view));
    }

    if (selected?.startsWith("module:")) return showDetails(modulePanel(ctx, selected, null));

    if (selected && view) {
      const item = view.items.find((candidate) => candidate.id === selected);
      const node = item?.target ? tree().nodes.get(item.target) : undefined;

      if (item && node) return showDetails(nodePanel(ctx, node, item, view, false));
    }

    const node = tree().nodes.get(state.map.node);

    return showDetails(!node || node.kind === "root" ? overviewPanel(ctx) : nodePanel(ctx, node, null, view, true));
  }

  if (state.tab === "routes") {
    const route = state.routes.selected ? index().routes.get(state.routes.selected) : undefined;
    const view = state.routes.view;

    if (!route || !view)
      return showDetails(routesListPanel(ctx, state.routes.filter, (value) => (state.routes.filter = value)));

    const item = state.routes.item ? view.items.find((candidate) => candidate.id === state.routes.item) : undefined;

    if (item) return showDetails(routeItemPanel(ctx, item, () => selectIn("routes", null)));

    return showDetails(routePanel(ctx, route, view));
  }

  if (state.tab === "logic" && state.logic.data) {
    return showDetails(
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
            (state.logic.data?.nodes ?? [])
              .filter((node) => structuralKinds.has(node.kind) && node.region !== null)
              .map((node) => node.id),
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

  const call = state.functions.scene?.edges.find((edge) => edge.id === selected);

  if (call) return showDetails(callEdgePanel(ctx, call.source, call.target));
  if (selected) return showDetails(functionPanel(ctx, selected));

  return showDetails(
    state.functions.explored ? functionsOverviewPanel(ctx, state.functions.explored) : overviewPanel(ctx),
  );
};

const renderLayoutOptions = () => {
  const options: [string, string][] = [
    ["cose", "Force layout"],
    ["breadthfirst", "Layered layout"],
  ];

  elements.layout.replaceChildren(...options.map(([value, label]) => h("option", { value }, label)));
  elements.layout.value = state.functions.layout;
};

const updateToolbar = () => {
  const activeTab = state.tab === "logic" ? "functions" : state.tab;

  Object.entries(elements.tabs).forEach(([tab, button]) => {
    button.classList.toggle("active", activeTab === tab);
    button.setAttribute("aria-selected", String(activeTab === tab));
  });

  elements.tabs.functions.disabled = state.functions.explored === null;
  elements.tabs.functions.textContent = state.tab === "logic" ? "Functions › Logic" : "Functions";
  elements.tabs.routes.disabled = (state.loaded?.snapshot.routes.length ?? 0) === 0;

  elements.tabControls.forEach((control) => {
    control.hidden = !(control.dataset.tabs ?? "").split(" ").includes(state.tab);
  });

  elements.focus.disabled = currentSelection(state.tab) === null;
  elements.focus.checked = state.functions.focus;
  elements.grouping.value = state.map.grouping;
  elements.color.value = state.color;
  elements.rescan.disabled = state.scanning;
  elements.rescan.textContent = state.scanning ? "Scanning…" : "Rescan";

  renderLayoutOptions();
};

const updateEmptyState = () => {
  if (!state.loaded) return showEmpty("Loading…");
  if (data().modules.length === 0)
    return showEmpty(`No .js, .jsx, .ts, .tsx or .svelte files found in ${data().root}.`);
  if (state.tab === "routes" && !state.routes.selected) return showEmpty("Pick a route from the list on the right.");

  if (state.tab === "functions") {
    const module = state.functions.explored ? index().modules.get(state.functions.explored) : undefined;
    if (module && module.functionIds.length === 0) {
      return showEmpty("No functions are declared in this file. Top-level code and Svelte markup are not measured.");
    }
  }

  if (state.tab === "map" && state.map.view && state.map.view.items.length === 0)
    return showEmpty("Nothing to show here.");

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
  state.loaded = { snapshot, index: buildIndex(snapshot), tree: buildTree(snapshot, mapOptions()) };
  if (!tree().nodes.has(state.map.node)) state.map.node = "root";

  document.title = `${snapshot.name} · Laqueus`;
  elements.projectName.textContent = snapshot.name;
  renderDiagnostics();

  if (state.map.path && state.map.path.some((id) => !index().modules.has(id))) state.map.path = null;
  if (state.routes.selected && !index().routes.has(state.routes.selected)) state.routes.selected = null;

  if (state.functions.explored && !index().modules.has(state.functions.explored)) {
    state.functions.explored = null;
    graphs.functions.clear();
    state.functions.scene = null;
    if (state.tab === "functions") state.tab = state.previousTab;
  }
};

const applyHash = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));

  state.applyingHash = true;
  state.map.grouping = params.get("group") === "folders" ? "folders" : "areas";
  state.color = params.get("color") === "complexity" ? "complexity" : "side";
  state.map.tray = new Set((params.get("tray") ?? "").split(",").filter(isTraySide));

  syncTrayInputs();
  rebuildTree();

  const tab = tabs.find((candidate) => candidate === params.get("tab")) ?? "map";
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
  } else {
    const path = params.get("path")?.split("|") ?? [];
    const [from, to] = path;

    if (path.length === 2 && from && to) openPath(from, to);
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
    toast(`Rescan failed: ${await errorOf(response)}. Showing the previous scan.`, true);
  } else {
    setSnapshot((await response.json()) as GraphSnapshot);
    state.applyingHash = true;

    if (state.tab === "map") renderMapGraph();
    if (state.tab === "routes") renderRoutesGraph();

    if (state.tab === "functions" && state.functions.explored) {
      const explored = state.functions.explored;
      const selected = state.functions.selected;

      graphs.functions.clear();
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
    .toSorted((a, b) => b.moduleIds.length - a.moduleIds.length)[0]?.id;

const searchHits = (query: string): SearchHit[] => {
  const needle = query.trim().toLowerCase();

  if (!needle || !state.loaded) return [];

  const rank = (text: string) => (text.toLowerCase().startsWith(needle) ? 0 : 1);
  const multipleApps = new Set(data().routes.map((route) => route.app)).size > 1;
  const files = data()
    .modules.filter((module) => module.path.toLowerCase().includes(needle))
    .toSorted((a, b) => rank(basename(a.path)) - rank(basename(b.path)) || a.path.length - b.path.length)
    .slice(0, 7)
    .map((module) => ({ label: basename(module.path), detail: module.path, run: () => revealModule(module.id) }));
  const areas = data()
    .areas.filter((area) => area.label.toLowerCase().includes(needle))
    .slice(0, 4)
    .flatMap((area) => {
      const node = bestSideNode(area.id);
      return node
        ? [
            {
              label: area.label,
              detail: `Area · ${plural(area.moduleIds.length, "file")}`,
              run: () => openMapNode(node),
            },
          ]
        : [];
    });
  const routes = data()
    .routes.filter((route) => routeLabel(route, multipleApps).toLowerCase().includes(needle))
    .slice(0, 4)
    .map((route) => ({
      label: routeLabel(route, multipleApps),
      detail: `Route · ${route.directory}`,
      run: () => openRoute(route.id),
    }));
  const functions = data()
    .functions.filter((fn) => fn.name.toLowerCase().includes(needle))
    .toSorted((a, b) => rank(a.name) - rank(b.name) || b.complexity - a.complexity)
    .slice(0, 6)
    .map((fn) => ({
      label: `${fn.name} · CC ${fn.complexity}`,
      detail: lineRef(fn.location),
      run: () => exploreFunctions(fn.moduleId, fn.id),
    }));

  return [...files, ...areas, ...routes, ...functions];
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
      ? [h("li", { class: "note" }, "No matching files, areas, routes or functions.")]
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
  elements.tabs.map.addEventListener("click", () => openMapNode(state.map.node, state.map.selected));
  elements.tabs.routes.addEventListener("click", () => openRoute(state.routes.selected));

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

    Object.values(graphs).forEach((graph) => graph.setColor(state.color));
    refresh();
    writeHash(false);
  });

  elements.trayInputs.forEach((input) =>
    input.addEventListener("change", () => {
      const side = input.dataset.tray;

      if (!isTraySide(side)) return;
      if (input.checked) state.map.tray.add(side);
      else state.map.tray.delete(side);

      rebuildTree();
      openMapNode(state.map.node, state.map.selected);
    }),
  );

  elements.fit.addEventListener("click", () => {
    graphs[state.tab].fit();
  });

  elements.rescan.addEventListener("click", () => void rescan());

  elements.layout.addEventListener("change", () => {
    state.functions.layout = elements.layout.value === "breadthfirst" ? "breadthfirst" : "cose";

    const scene = state.functions.scene;
    if (scene) graphs.functions.relayout(functionCenters(scene, visibleFunctions(scene)));
  });

  elements.focus.addEventListener("change", () => {
    if (state.tab === "functions") {
      state.functions.focus = elements.focus.checked;
      refreshFunctionGraph(true);
    }
    updateEmptyState();
  });

  elements.warnings.addEventListener("click", () => {
    elements.diagnostics.hidden = !elements.diagnostics.hidden;
    elements.warnings.setAttribute("aria-expanded", String(!elements.diagnostics.hidden));
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
    const hit = state.searchHits[state.activeHit];

    if (event.key === "ArrowDown" && count > 0) state.activeHit = (state.activeHit + 1) % count;
    else if (event.key === "ArrowUp" && count > 0) state.activeHit = (state.activeHit - 1 + count) % count;
    else if (event.key === "Enter" && hit) {
      return runHit(hit);
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
      openViewItem(state.map.view, state.map.selected);
    }
  });

  window.addEventListener("popstate", () => {
    if (state.loaded) applyHash();
  });
};

const start = async () => {
  wireToolbar();
  showEmpty("Loading…");

  const response = await fetch("/api/graph").catch(() => null);

  if (!response?.ok) {
    showEmpty("Could not load the graph. Is laqueus still running?");
    return;
  }

  // The server shares its types through src/model.
  setSnapshot((await response.json()) as GraphSnapshot);
  applyHash();
};

void start();
