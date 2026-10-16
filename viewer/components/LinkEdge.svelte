<script lang="ts">
  import { BaseEdge, type EdgeProps, EdgeLabel } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type GraphContext, type GraphEdge, edgePaint, edgeTone, graphContext, linkGeometry, noShape } from "../scene";

  let { id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdge> = $props();

  const graph = getContext<GraphContext>(graphContext);

  const tone = $derived(edgeTone(graph.look, graph.selected, id));
  const paint = $derived(edgePaint(tone, graph.look, id, data));
  const geometry = $derived(
    linkGeometry(
      { x: sourceX, y: sourceY },
      { x: targetX, y: targetY },
      { source: graph.shapes.get(source) ?? noShape, target: graph.shapes.get(target) ?? noShape },
      { width: paint.width, bend: data?.bend ?? 0, loop: source === target },
    ),
  );
</script>

<BaseEdge
  {id}
  path={geometry.path}
  style="stroke: {paint.stroke}; stroke-width: {paint.width}px;{paint.dash ? ` stroke-dasharray: ${paint.dash};` : ''}"
/>
<polygon class="arrow" points={geometry.arrow} fill={paint.stroke} />
{#if data?.label}
  <EdgeLabel x={geometry.label.x} y={geometry.label.y} class="graph-edge-label" style="color: {paint.label};">
    {data.label}
  </EdgeLabel>
{/if}

<style>
  .arrow {
    pointer-events: none;
  }

  :global(.graph-edge-label) {
    padding: 0 2px;
    border-radius: 3px;
    background: var(--bg);
    font-size: 11px;
  }
</style>
