<script lang="ts">
  import { getContext } from "svelte";
  import type { Point } from "../../src/model";
  import { type GraphContext, type edgePaint, graphContext } from "../scene";

  type Props = {
    id: string;
    path: string;
    arrow: string;
    at: Point;
    label: string;
    paint: ReturnType<typeof edgePaint>;
  };

  let { id, path, arrow, at, label, paint }: Props = $props();

  const graph = getContext<GraphContext>(graphContext);
</script>

<g>
  <path
    class="line"
    d={path}
    style:stroke={paint.stroke}
    style:stroke-width="{paint.width}px"
    style:stroke-dasharray={paint.dash}
  />
  <polygon class="arrow" points={arrow} style:fill={paint.stroke} />
  <path class="hit" d={path} onclick={() => graph.select(id)} role="presentation" />
  {#if label}
    <text class="label" x={at.x} y={at.y} style:fill={paint.label}>{label}</text>
  {/if}
</g>

<style>
  .line {
    fill: none;
  }

  .arrow {
    pointer-events: none;
  }

  .hit {
    fill: none;
    stroke: transparent;
    stroke-width: 20px;
    pointer-events: stroke;
  }

  .label {
    font-size: 11px;
    text-anchor: middle;
    dominant-baseline: central;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4px;
    stroke-linejoin: round;
    pointer-events: none;
  }
</style>
