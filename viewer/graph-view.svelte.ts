import { mount, tick, unmount } from "svelte";
import Graph from "./components/Graph.svelte";
import type { ColorMode } from "./graph";
import type { Point } from "./layered";
import { type GraphControls, type Layout, type LookFn, type Placement, type Scene, type Viewport, plainLook } from "./scene";

export type GraphHandlers = { select: (id: string | null) => void; open: (id: string) => void };

export type ShowOptions = {
  scene: Scene;
  centers: ReadonlyMap<string, Point>;
  selected: string | null;
  color: ColorMode;
  look: LookFn;
  hover: boolean;
  placement: Placement;
};

export type GraphView = ReturnType<typeof createGraphView>;

/** Bridges the imperative viewer code to one Svelte Flow graph: one mount per scene, everything else reactive. */
export const createGraphView = (target: HTMLElement, handlers: GraphHandlers) => {
  const ui = $state({
    selected: null as string | null,
    color: "side" as ColorMode,
    look: (() => plainLook) as LookFn,
  });
  let layout = $state.raw<Layout>({ centers: new Map(), fit: false });
  const live = {
    app: null as ReturnType<typeof mount> | null,
    controls: null as GraphControls | null,
    pendingCenter: null as string | null,
  };

  const clear = () => {
    if (live.app) void unmount(live.app);
    live.app = null;
    live.controls = null;
    live.pendingCenter = null;
  };

  return {
    get mounted() {
      return live.app !== null;
    },
    show: (options: ShowOptions) => {
      clear();
      ui.selected = options.selected;
      ui.color = options.color;
      ui.look = options.look;
      layout = { centers: options.centers, fit: false };
      live.app = mount(Graph, {
        target,
        props: {
          scene: options.scene,
          get layout() {
            return layout;
          },
          placement: options.placement,
          hover: options.hover,
          frame: target,
          get selected() {
            return ui.selected;
          },
          get color() {
            return ui.color;
          },
          get look() {
            return ui.look;
          },
          onselect: handlers.select,
          onopen: handlers.open,
          onready: (controls: GraphControls) => {
            live.controls = controls;
            if (live.pendingCenter) controls.center(live.pendingCenter);
            live.pendingCenter = null;
          },
        },
      });
    },
    clear,
    select: (id: string | null) => {
      ui.selected = id;
    },
    update: (options: { selected: string | null; look: LookFn }) => {
      ui.selected = options.selected;
      ui.look = options.look;
    },
    setColor: (color: ColorMode) => {
      ui.color = color;
    },
    /** Moves the given nodes (others keep their place) and refits. */
    relayout: (centers: ReadonlyMap<string, Point>, fit = true) => {
      layout = { centers, fit };
    },
    /** Waits for pending filter and layout changes to reach the graph before moving the view. */
    fit: () => void tick().then(() => live.controls?.fit()),
    center: (id: string) => {
      if (live.controls) void tick().then(() => live.controls?.center(id));
      else live.pendingCenter = id;
    },
    viewport: (): Viewport | null => live.controls?.viewport() ?? null,
    positions: (): Map<string, Point> | null => live.controls?.positions() ?? null,
  };
};
