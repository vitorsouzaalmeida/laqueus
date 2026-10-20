<script lang="ts">
  import { getContext } from "svelte";
  import type { Point } from "../../src/model";
  import { type EdgeData, type GraphContext, edgePaint, edgeTone, graphContext, linkGeometry, noShape } from "../scene";
  import EdgeLine from "./EdgeLine.svelte";

  type Props = { id: string; source: string; target: string; from: Point; to: Point; data: EdgeData };

  let { id, source, target, from, to, data }: Props = $props();

  const graph = getContext<GraphContext>(graphContext);

  const flags = $derived(graph.mark(id));
  const tone = $derived(edgeTone(flags));
  const paint = $derived(edgePaint(tone, flags, data));
  const geometry = $derived(
    linkGeometry(
      from,
      to,
      { source: graph.shapes.get(source) ?? noShape, target: graph.shapes.get(target) ?? noShape },
      { width: paint.width, bend: data.bend, loop: source === target },
    ),
  );
</script>

<EdgeLine {id} path={geometry.path} arrow={geometry.arrow} at={geometry.label} label={data.label} {paint} />
