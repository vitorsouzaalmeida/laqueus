import { mount, tick, unmount } from "svelte";
import Graph from "./components/Graph.svelte";
import type { ColorMode } from "./graph";
import type { Point } from "../src/model";
import {
  type GraphControls,
  type Layout,
  type LookFn,
  type ViewPlacement,
  type Scene,
  type Viewport,
  plainLook,
} from "./scene";

export type GraphHandlers = { select: (id: string | null) => void; open: (id: string) => void };

export type Centers = ReadonlyMap<string, Point> | Promise<ReadonlyMap<string, Point>>;

export type ShowOptions = {
  scene: Scene;
  centers: Centers;
  selected: string | null;
  color: ColorMode;
  look: LookFn;
  hover: boolean;
  placement: ViewPlacement;
};

export type GraphView = ReturnType<typeof createGraphView>;

/** Bridges the imperative viewer code to one Svelte Flow graph: one mount per scene, everything else reactive. */
export const createGraphView = (target: HTMLElement, handlers: GraphHandlers) => {
  const ui = $state<{ selected: string | null; color: ColorMode; look: LookFn }>({
    selected: null,
    color: "side",
    look: () => plainLook,
  });
  let layout = $state.raw<Layout>({ centers: new Map(), fit: false });
  /** `scene` and `layout` count mounts and relayouts, so late async layouts can tell they are stale. */
  const live: {
    app: ReturnType<typeof mount> | null;
    controls: GraphControls | null;
    pendingCenter: string | null;
    scene: number;
    layout: number;
    waiting: boolean;
  } = { app: null, controls: null, pendingCenter: null, scene: 0, layout: 0, waiting: false };

  const clear = () => {
    if (live.app) void unmount(live.app);

    live.app = null;
    live.controls = null;
    live.pendingCenter = null;
    live.scene += 1;
    live.layout += 1;
    live.waiting = false;
  };

  return {
    get mounted() {
      return live.app !== null || live.waiting;
    },
    show: (options: ShowOptions) => {
      clear();
      ui.selected = options.selected;
      ui.color = options.color;
      ui.look = options.look;

      const scene = live.scene;
      const layouts = live.layout;
      const before = layout;

      const start = (centers: ReadonlyMap<string, Point>) => {
        if (scene !== live.scene) return;

        live.waiting = false;
        if (layouts === live.layout || layout === before) layout = { centers, fit: false };

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
      };

      if (options.centers instanceof Promise) {
        live.waiting = true;
        void options.centers.then(start);
      } else start(options.centers);
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
    relayout: (centers: Centers, fit = true) => {
      live.layout += 1;
      const run = live.layout;

      if (!(centers instanceof Promise)) layout = { centers, fit };
      else
        void centers.then((resolved) => {
          if (run === live.layout) layout = { centers: resolved, fit };
        });
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
