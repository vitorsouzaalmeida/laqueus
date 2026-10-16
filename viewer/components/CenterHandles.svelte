<script lang="ts">
  import { Handle, Position } from "@xyflow/svelte";
</script>

<!-- Edges are drawn centre to centre and clipped to each node's outline, so the handles sit invisibly in the middle. -->
<Handle type="target" position={Position.Top} isConnectable={false} class="center-handle" />
<Handle type="source" position={Position.Bottom} isConnectable={false} class="center-handle" />

<style>
  :global(.svelte-flow__handle.center-handle) {
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
