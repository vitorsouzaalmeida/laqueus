<script lang="ts">
  import type { NodeProps } from "@xyflow/svelte";
  import { getContext } from "svelte";
  import { type BoxData, type GraphContext, graphContext, has, mark } from "../scene";

  let { id, data }: NodeProps & { data: BoxData } = $props();

  const graph = getContext<GraphContext>(graphContext);
  const flags = $derived(graph.mark(id));

  const fill = $derived(
    graph.color === "complexity" ? `var(--cc-${data.bucket === 0 ? "none" : data.bucket})` : `var(--side-${data.side})`,
  );
</script>

<div
  class="box {data.kind}"
  class:dim={has(flags, mark.dim)}
  class:selected={has(flags, mark.selected)}
  class:cyclic={data.cyclic}
  class:complexity={graph.color === "complexity"}
  style:--fill={fill}
  style:--accent="var(--side-{data.side})"
  ondblclick={() => graph.open(id)}
  role="presentation"
>
  <span class="text">{data.label}</span>
</div>

<style>
  .box {
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;
    padding: 0 12px;
    border: 2px solid var(--accent);
    border-radius: 10px;
    text-align: center;
    white-space: pre-line;
  }

  .card {
    background: color-mix(in srgb, var(--fill) 16%, var(--bg));
    color: var(--text);
    font-size: 13px;
    line-height: 1.35;
  }

  .card.complexity {
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

  .cyclic {
    border: 3px solid var(--cycle);
  }

  .selected {
    border: 4px solid var(--edge-strong);
    font-weight: 700;
  }

  .dim {
    background: var(--dim);
    border-color: var(--dim);
    color: var(--dim-text);
    opacity: 0.35;
  }
</style>
