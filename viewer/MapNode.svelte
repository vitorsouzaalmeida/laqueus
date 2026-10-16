<script lang="ts">
  import { Handle, type NodeProps, Position } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { card, stub } from "./graph";
  import { type MapContext, type MapFlowNode, fileDot, mapContext } from "./map-flow";

  let { id, data }: NodeProps<MapFlowNode> = $props();

  const map = getContext<MapContext>(mapContext);

  const dim = $derived(map.emphasis.focus !== null && !map.emphasis.around.has(id));
  const fill = $derived(
    map.color === "complexity" ? `var(--cc-${data.bucket === 0 ? "none" : data.bucket})` : `var(--side-${data.side})`,
  );
  const size = $derived(
    data.kind === "group"
      ? { width: card.width, height: card.height }
      : data.kind === "stub"
        ? { width: stub.width, height: stub.height }
        : { width: fileDot(data.entry), height: fileDot(data.entry) },
  );
</script>

<div
  class="map-node {data.kind}"
  class:dim
  class:selected={map.selected === id}
  class:cyclic={data.cyclic}
  class:entry={data.entry}
  class:complexity={map.color === "complexity"}
  style:--fill={fill}
  style:--accent="var(--side-{data.side})"
  style:width="{size.width}px"
  style:height="{size.height}px"
  ondblclick={() => map.open(id)}
  role="presentation"
>
  {#if data.kind === "file"}
    <span class="dot"></span>
    <span class="caption">{data.label}</span>
  {:else}
    <span class="text">{data.label}</span>
  {/if}
  <Handle type="target" position={Position.Top} isConnectable={false} class="map-handle" />
  <Handle type="source" position={Position.Bottom} isConnectable={false} class="map-handle" />
</div>

<style>
  .map-node {
    position: relative;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    white-space: pre-line;
  }

  .group,
  .stub {
    padding: 0 12px;
    border-radius: 10px;
    border: 2px solid var(--accent);
  }

  .group {
    background: color-mix(in srgb, var(--fill) 16%, var(--bg));
    color: var(--text);
    font-size: 13px;
    line-height: 1.35;
  }

  .group.complexity {
    background: color-mix(in srgb, var(--fill) 45%, var(--bg));
  }

  .stub {
    background: var(--panel);
    border-style: dashed;
    color: var(--muted);
    font-size: 12px;
  }

  .text {
    overflow: hidden;
    max-height: 100%;
  }

  .dot {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--edge);
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
    width: 170px;
    transform: translateX(-50%);
    color: var(--label);
    font-size: 11px;
    line-height: 1.3;
    pointer-events: none;
  }

  .cyclic.group,
  .cyclic .dot {
    border: 3px solid var(--cycle);
  }

  .selected.group,
  .selected.stub,
  .selected .dot {
    border: 4px solid var(--edge-strong);
  }

  .selected .caption,
  .selected .text {
    font-weight: 700;
  }

  .dim .dot,
  .dim.group,
  .dim.stub {
    background: var(--dim);
    border-color: var(--dim);
    color: var(--dim-text);
  }

  .dim .caption {
    color: var(--dim-text);
  }

  .dim.group,
  .dim.stub {
    opacity: 0.35;
  }

  :global(.svelte-flow__handle.map-handle) {
    top: 50%;
    left: 50%;
    width: 1px;
    height: 1px;
    min-width: 0;
    min-height: 0;
    border: 0;
    opacity: 0;
    pointer-events: none;
    transform: translate(-50%, -50%);
  }
</style>
