<script lang="ts">
  import { type EdgeTypes, type NodeTypes, SvelteFlow } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { setContext } from "svelte";
  import type { ColorMode } from "./graph";
  import MapEdge from "./MapEdge.svelte";
  import MapNode from "./MapNode.svelte";
  import MapViewport from "./MapViewport.svelte";
  import {
    type MapContext,
    type MapFlowEdge,
    type MapFlowNode,
    type MapScene,
    type ViewportControls,
    emphasisOf,
    mapContext,
  } from "./map-flow";

  type Props = {
    scene: MapScene;
    selected: string | null;
    color: ColorMode;
    onselect: (id: string | null) => void;
    onopen: (id: string) => void;
    onready: (controls: ViewportControls) => void;
  };

  let { scene, selected, color, onselect, onopen, onready }: Props = $props();

  // The component is remounted for every scene, so only dragging changes these afterwards.
  // svelte-ignore state_referenced_locally
  let nodes = $state.raw<MapFlowNode[]>(scene.nodes);
  // svelte-ignore state_referenced_locally
  let edges = $state.raw<MapFlowEdge[]>(scene.edges);
  let hovered = $state<string | null>(null);

  const emphasis = $derived(emphasisOf(scene, hovered ?? selected));

  setContext<MapContext>(mapContext, {
    get emphasis() {
      return emphasis;
    },
    get selected() {
      return selected;
    },
    get color() {
      return color;
    },
    open: (id) => onopen(id),
  });

  const nodeTypes: NodeTypes = { map: MapNode };
  const edgeTypes: EdgeTypes = { map: MapEdge };
</script>

<SvelteFlow
  bind:nodes
  bind:edges
  {nodeTypes}
  {edgeTypes}
  nodeOrigin={[0.5, 0.5]}
  minZoom={0.02}
  maxZoom={4}
  colorMode="system"
  nodesConnectable={false}
  elementsSelectable={false}
  zoomOnDoubleClick={false}
  deleteKey={null}
  onnodeclick={({ node }) => onselect(node.id)}
  onedgeclick={({ edge }) => onselect(edge.id)}
  onpaneclick={() => onselect(null)}
  onnodepointerenter={({ node }) => (hovered = node.id)}
  onnodepointerleave={() => (hovered = null)}
>
  <MapViewport center={scene.center} {onready} />
</SvelteFlow>

<style>
  :global(.svelte-flow) {
    --xy-background-color: transparent;
  }
</style>
