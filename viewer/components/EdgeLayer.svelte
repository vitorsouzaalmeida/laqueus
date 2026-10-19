<script lang="ts">
  import { ViewportPortal } from "@xyflow/svelte";
  import type { Point } from "../layered";
  import type { EdgeData, GraphEdge } from "../scene";
  import LinkEdge from "./LinkEdge.svelte";
  import StepEdge from "./StepEdge.svelte";

  let { edges, centers }: { edges: GraphEdge[]; centers: ReadonlyMap<string, Point> } = $props();

  const nowhere: Point = { x: 0, y: 0 };

  const ordered = $derived([...edges].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)));
</script>

<ViewportPortal target="back">
  <svg class="graph-edges">
    {#each ordered as edge (edge.id)}
      {@const props = {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        from: centers.get(edge.source) ?? nowhere,
        to: centers.get(edge.target) ?? nowhere,
        data: edge.data as EdgeData,
      }}
      {#if edge.type === "step"}
        <StepEdge {...props} />
      {:else}
        <LinkEdge {...props} />
      {/if}
    {/each}
  </svg>
</ViewportPortal>

<style>
  .graph-edges {
    position: absolute;
    top: 0;
    left: 0;
    z-index: 2;
    width: 1px;
    height: 1px;
    overflow: visible;
    pointer-events: none;
  }
</style>
