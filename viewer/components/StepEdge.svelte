<script lang="ts">
  import { Position, getSmoothStepPath } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import type { Point } from "../layered";
  import { type EdgeData, type GraphContext, type Shape, arrowHead, edgePaint, edgeTone, graphContext } from "../scene";
  import EdgeLine from "./EdgeLine.svelte";

  type Props = { id: string; source: string; target: string; from: Point; to: Point; data: EdgeData };

  let { id, source, target, from, to, data }: Props = $props();

  const graph = getContext<GraphContext>(graphContext);

  const halfHeight = (shape: Shape | undefined) =>
    shape === undefined ? 0 : shape.kind === "circle" ? shape.radius : shape.halfHeight;

  const flags = $derived(graph.mark(id));
  const tone = $derived(edgeTone(flags));
  const paint = $derived(edgePaint(tone, flags, data));
  const geometry = $derived.by(() => {
    const start = { x: from.x, y: from.y + halfHeight(graph.shapes.get(source)) };
    const tip = { x: to.x, y: to.y - halfHeight(graph.shapes.get(target)) };
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

<EdgeLine {id} path={geometry.path} arrow={geometry.arrow} at={geometry.label} label={data.label} {paint} />
