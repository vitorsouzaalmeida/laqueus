<script lang="ts">
  import { BaseEdge, type EdgeProps, EdgeLabel } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type MapContext, type MapFlowEdge, edgeGeometry, mapContext } from "./map-flow";

  let { id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<MapFlowEdge> = $props();

  const map = getContext<MapContext>(mapContext);

  const tone = $derived(
    map.emphasis.outgoing.has(id) || map.selected === id
      ? "outgoing"
      : map.emphasis.incoming.has(id)
        ? "incoming"
        : map.emphasis.focus !== null && !map.emphasis.around.has(id)
          ? "dim"
          : "normal",
  );
  const width = $derived(tone === "outgoing" || tone === "incoming" ? 2.6 : (data?.width ?? 1.6));
  const geometry = $derived(
    data ? edgeGeometry({ x: sourceX, y: sourceY }, { x: targetX, y: targetY }, { ...data, width }) : null,
  );
  const stroke = $derived(
    { outgoing: "var(--edge-strong)", incoming: "var(--edge-in)", dim: "var(--dim)", normal: "var(--edge)" }[tone],
  );
</script>

{#if geometry}
  <BaseEdge {id} path={geometry.path} style="stroke: {stroke}; stroke-width: {width}px;" />
  <polygon class="arrow" points={geometry.arrow} fill={stroke} />
  {#if data?.label}
    <EdgeLabel x={geometry.label.x} y={geometry.label.y} class="map-edge-label {tone}">{data.label}</EdgeLabel>
  {/if}
{/if}

<style>
  .arrow {
    pointer-events: none;
  }

  :global(.map-edge-label) {
    padding: 0 2px;
    border-radius: 3px;
    background: var(--bg);
    color: var(--muted);
    font-size: 11px;
  }

  :global(.map-edge-label.outgoing) {
    color: var(--edge-strong);
  }

  :global(.map-edge-label.incoming) {
    color: var(--edge-in);
  }

  :global(.map-edge-label.dim) {
    color: var(--dim-text);
  }
</style>
