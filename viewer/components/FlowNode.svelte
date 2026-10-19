<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type FlowData, type GraphContext, graphContext, has, mark } from "../scene";

  let { id, data, width, height }: NodeProps & { data: FlowData } = $props();

  const graph = getContext<GraphContext>(graphContext);
  const flags = $derived(graph.mark(id));

  const w = $derived(width ?? 0);
  const h = $derived(height ?? 0);

  const outline = $derived.by(() => {
    if (data.flowKind === "decision" || data.flowKind === "switch") {
      return `${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`;
    }
    if (data.flowKind === "loop") {
      return `${w * 0.12},1 ${w * 0.88},1 ${w - 1},${h / 2} ${w * 0.88},${h - 1} ${w * 0.12},${h - 1} 1,${h / 2}`;
    }
    if (data.flowKind === "try" || data.flowKind === "finally" || data.flowKind === "catch") {
      const cut = 9;
      return `${cut},1 ${w - cut},1 ${w - 1},${cut} ${w - 1},${h - cut} ${w - cut},${h - 1} ${cut},${h - 1} 1,${h - cut} 1,${cut}`;
    }
    return null;
  });
</script>

<div
  class="flow-node kind-{data.flowKind}"
  class:unreachable={data.unreachable}
  class:dim={has(flags, mark.dim)}
  class:path={has(flags, mark.path)}
  class:selected={has(flags, mark.selected)}
  ondblclick={() => graph.open(id)}
  role="presentation"
>
  <svg class="shape" viewBox="0 0 {w} {h}" aria-hidden="true">
    {#if outline}
      <polygon points={outline} />
    {:else}
      <rect x="1" y="1" width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx="6" />
    {/if}
  </svg>
  <span class="text">{data.label}</span>
</div>

<style>
  .flow-node {
    --shape-fill: var(--panel);
    --shape-stroke: var(--edge);
    --shape-width: 1.5px;
    --shape-dash: none;
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    color: var(--text);
    font-size: 11px;
    line-height: 1.3;
    text-align: center;
    white-space: pre-line;
  }

  .shape {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .shape :is(rect, polygon) {
    fill: var(--shape-fill);
    stroke: var(--shape-stroke);
    stroke-width: var(--shape-width);
    stroke-dasharray: var(--shape-dash);
  }

  .text {
    position: relative;
    padding: 0 10px;
  }

  .kind-block .text {
    font-family: var(--mono);
    text-align: left;
  }

  .kind-start {
    --shape-stroke: var(--side-shared);
    --shape-width: 2.5px;
    font-weight: 700;
  }

  .kind-end {
    --shape-stroke: var(--muted);
    color: var(--muted);
  }

  .kind-decision,
  .kind-switch {
    --shape-fill: var(--decision);
    --shape-stroke: var(--decision-border);
    --shape-width: 2px;
  }

  .kind-loop {
    --shape-fill: var(--loop);
    --shape-stroke: var(--loop-border);
    --shape-width: 2px;
  }

  .kind-try,
  .kind-finally {
    --shape-stroke: var(--muted);
  }

  .kind-catch {
    --shape-stroke: var(--flow-throw);
    --shape-width: 2px;
  }

  .kind-return {
    --shape-stroke: var(--flow-return);
    --shape-width: 2.5px;
  }

  .kind-throw {
    --shape-stroke: var(--flow-throw);
    --shape-width: 2.5px;
  }

  .kind-collapsed {
    --shape-stroke: var(--muted);
    --shape-dash: 5 4;
    color: var(--muted);
  }

  .unreachable {
    --shape-dash: 5 4;
    opacity: 0.55;
  }

  .path {
    --shape-width: 3px;
  }

  .selected {
    --shape-stroke: var(--edge-strong);
    --shape-width: 4px;
    font-weight: 700;
  }

  .dim {
    --shape-fill: var(--dim);
    --shape-stroke: var(--dim);
    color: var(--dim-text);
  }
</style>
