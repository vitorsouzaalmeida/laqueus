<script lang="ts">
  import { useNodesInitialized, useSvelteFlow } from "@xyflow/svelte";
  import { tick, untrack } from "svelte";
  import { type GraphControls, type Placement, centersOf } from "../scene";

  type Props = { placement: Placement; fitSignal: number; frame: HTMLElement; onready: (controls: GraphControls) => void };

  let { placement, fitSignal, frame, onready }: Props = $props();

  const flow = useSvelteFlow();
  const initialized = useNodesInitialized();
  const comfortableZoom = 1.5;

  const fit = () => flow.fitView({ padding: "40px", maxZoom: comfortableZoom });

  const centerOf = (id: string) => {
    const node = flow.getInternalNode(id);
    if (!node || node.hidden) return null;
    const { x, y } = node.internals.positionAbsolute;
    return {
      x: x + (node.width ?? node.measured.width ?? 0) / 2,
      y: y + (node.height ?? node.measured.height ?? 0) / 2,
    };
  };

  const center = (id: string) => {
    const at = centerOf(id);
    if (!at) return;
    void flow.setCenter(at.x, at.y, { zoom: Math.max(flow.getZoom(), 1), duration: 250 });
  };

  /** Large flowcharts start readable at the top instead of shrunk to fit. */
  const startAtTop = (id: string) => {
    const at = centerOf(id);
    if (!at || flow.getZoom() >= 0.55) return;
    const zoom = 0.9;
    void flow.setViewport({ zoom, x: frame.clientWidth / 2 - at.x * zoom, y: 60 - at.y * zoom });
  };

  const controls: GraphControls = {
    fit: () => void fit(),
    center,
    viewport: () => flow.getViewport(),
    positions: () => centersOf(flow.getNodes()),
  };

  const place = async () => {
    if (placement !== "fit" && "viewport" in placement) {
      await flow.setViewport(placement.viewport);
      return;
    }
    await fit();
    if (placement === "fit") return;
    if ("center" in placement) center(placement.center);
    else startAtTop(placement.top);
  };

  let placed = false;
  $effect(() => {
    if (!initialized.current || placed) return;
    placed = true;
    void place().then(() => onready(controls));
  });

  let seenSignal = untrack(() => fitSignal);
  $effect(() => {
    if (fitSignal === seenSignal) return;
    seenSignal = fitSignal;
    if (placed) void tick().then(fit);
  });
</script>
