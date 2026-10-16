<script lang="ts">
  import { BaseEdge, type EdgeProps, EdgeLabel, Position, getSmoothStepPath } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type GraphContext, type GraphEdge, type Shape, arrowHead, edgePaint, edgeTone, graphContext } from "../scene";

  let { id, source, target, sourceX, sourceY, targetX, targetY, data }: EdgeProps<GraphEdge> = $props();

  const graph = getContext<GraphContext>(graphContext);

  const halfHeight = (shape: Shape | undefined) =>
    shape === undefined ? 0 : shape.kind === "circle" ? shape.radius : shape.halfHeight;

  const tone = $derived(edgeTone(graph.look, graph.selected, id));
  const paint = $derived(edgePaint(tone, graph.look, id, data));
  const geometry = $derived.by(() => {
    const start = { x: sourceX, y: sourceY + halfHeight(graph.shapes.get(source)) };
    const tip = { x: targetX, y: targetY - halfHeight(graph.shapes.get(target)) };
    const arrow = arrowHead(tip, { x: 0, y: 1 }, paint.width);
    const [path, labelX, labelY] = getSmoothStepPath({
      sourceX: start.x,
      sourceY: start.y,
      sourcePosition: Position.Bottom,
      targetX: arrow.end.x,
      targetY: arrow.end.y,
      targetPosition: Position.Top,
      borderRadius: 6,
      offset: 22,
      ...(arrow.end.y > start.y + 44 ? { centerY: start.y + 22 } : {}),
    });
    return { path, arrow: arrow.points, label: { x: labelX, y: labelY } };
  });
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
</style>
