<script lang="ts">
  import { useNodesInitialized, useSvelteFlow } from "@xyflow/svelte";
  import type { ViewportControls } from "./map-flow";

  type Props = { center: string | null; onready: (controls: ViewportControls) => void };

  let { center, onready }: Props = $props();

  const flow = useSvelteFlow();
  const initialized = useNodesInitialized();
  const comfortableZoom = 1.5;

  const fit = () => flow.fitView({ padding: "40px", maxZoom: comfortableZoom });

  const centerOn = (id: string) => {
    const node = flow.getNode(id);
    if (!node) return;
    void flow.setCenter(node.position.x, node.position.y, { zoom: Math.max(flow.getZoom(), 1), duration: 250 });
  };

  let placed = false;
  $effect(() => {
    if (!initialized.current || placed) return;
    placed = true;
    void fit().then(() => {
      if (center) centerOn(center);
    });
    onready({ fit: () => void fit() });
  });
</script>
