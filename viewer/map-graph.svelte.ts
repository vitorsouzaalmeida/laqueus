import { mount, unmount } from "svelte";
import type { ColorMode } from "./graph";
import MapGraph from "./MapGraph.svelte";
import type { MapScene, ViewportControls } from "./map-flow";

export type MapGraphHandlers = { select: (id: string | null) => void; open: (id: string) => void };

/** Bridges the imperative viewer code to the Svelte Flow map: one mount per scene, reactive selection and colour. */
export const createMapGraph = (target: HTMLElement, handlers: MapGraphHandlers) => {
  const ui = $state({ selected: null as string | null, color: "side" as ColorMode });
  const live = { app: null as ReturnType<typeof mount> | null, controls: null as ViewportControls | null };
  return {
    show: (scene: MapScene, selected: string | null, color: ColorMode) => {
      if (live.app) void unmount(live.app);
      ui.selected = selected;
      ui.color = color;
      live.controls = null;
      live.app = mount(MapGraph, {
        target,
        props: {
          scene,
          get selected() {
            return ui.selected;
          },
          get color() {
            return ui.color;
          },
          onselect: handlers.select,
          onopen: handlers.open,
          onready: (controls: ViewportControls) => (live.controls = controls),
        },
      });
    },
    select: (id: string | null) => {
      ui.selected = id;
    },
    setColor: (color: ColorMode) => {
      ui.color = color;
    },
    fit: () => live.controls?.fit(),
  };
};
