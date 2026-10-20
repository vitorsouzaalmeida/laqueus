<script lang="ts">
  import { ViewportPortal } from "@xyflow/svelte";
  import type { Point } from "../../src/model";
  import type { GraphEdge } from "../scene";
  import LinkEdge from "./LinkEdge.svelte";
  import StepEdge from "./StepEdge.svelte";

  let { edges, centers }: { edges: GraphEdge[]; centers: ReadonlyMap<string, Point> } = $props();

  const nowhere: Point = { x: 0, y: 0 };

  const ordered = $derived(edges.toSorted((a, b) => a.zIndex - b.zIndex));
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
        data: edge.data,
      }}
      {#if edge.data.route === "step"}
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
