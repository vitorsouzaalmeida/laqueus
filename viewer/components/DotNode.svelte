<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type DotData, type GraphContext, graphContext, has, mark } from "../scene";

  let { id, data }: NodeProps & { data: DotData } = $props();

  const graph = getContext<GraphContext>(graphContext);
  const flags = $derived(graph.mark(id));

  const fill = $derived(
    data.tint === "bucket" || graph.color === "complexity"
      ? `var(--cc-${data.bucket === 0 ? "none" : data.bucket})`
      : `var(--side-${data.side})`,
  );
</script>

<div
  class="dot-node"
  class:dim={has(flags, mark.dim)}
  class:selected={has(flags, mark.selected)}
  class:cyclic={data.cyclic}
  class:entry={data.entry}
  style:--fill={fill}
  style:--caption-width="{data.captionWidth}px"
  style:--font-size="{data.fontSize}px"
  ondblclick={() => graph.open(id)}
  role="presentation"
>
  <span class="dot"></span>
  <span class="caption">{data.label}</span>
</div>

<style>
  .dot-node {
    position: relative;
    width: 100%;
    height: 100%;
  }

  .dot {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    border: 1px solid var(--edge);
    border-radius: 50%;
    background: var(--fill);
  }

  .entry .dot {
    border-radius: 2px;
    transform: rotate(45deg) scale(0.75);
  }

  .caption {
    position: absolute;
    top: calc(100% + 4px);
    left: 50%;
    width: var(--caption-width);
    transform: translateX(-50%);
    color: var(--label);
    font-size: var(--font-size);
    line-height: 1.3;
    text-align: center;
    white-space: pre-line;
    pointer-events: none;
  }

  .cyclic .dot {
    border: 3px solid var(--cycle);
  }

  .selected .dot {
    border: 4px solid var(--edge-strong);
  }

  .selected .caption {
    font-weight: 700;
  }

  .dim .dot {
    background: var(--dim);
    border-color: var(--dim);
  }

  .dim .caption {
    color: var(--dim-text);
  }
</style>
