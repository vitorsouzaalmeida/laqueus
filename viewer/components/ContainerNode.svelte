<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type ContainerData, type GraphContext, graphContext } from "../scene";
  import CenterHandles from "./CenterHandles.svelte";

  let { id, data, width }: NodeProps & { data: ContainerData } = $props();

  const graph = getContext<GraphContext>(graphContext);

  const fontSize = $derived(
    data.variant === "lane"
      ? Math.min(220, Math.max(30, (width ?? 0) / 10))
      : Math.min(20, Math.max(13, (width ?? 0) / 18)),
  );
</script>

<div
  class="container {data.variant}"
  class:selected={graph.selected === id}
  ondblclick={() => graph.open(id)}
  role="presentation"
>
  <span class="label" style:font-size="{fontSize}px">{data.label}</span>
  <CenterHandles />
</div>

<style>
  .container {
    position: relative;
    box-sizing: border-box;
    width: 100%;
    height: 100%;
    border-radius: 10px;
  }

  .lane {
    background: var(--lane);
  }

  .group {
    background: var(--group);
    border: 1px solid var(--group-border);
  }

  .group.selected {
    border: 3px solid var(--edge-strong);
  }

  .label {
    position: absolute;
    bottom: calc(100% + 4px);
    left: 50%;
    transform: translateX(-50%);
    font-weight: 700;
    white-space: nowrap;
  }

  .lane .label {
    color: var(--muted);
  }

  .group .label {
    color: var(--text);
  }
</style>
