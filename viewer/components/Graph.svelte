<script lang="ts">
  import { type EdgeTypes, type NodeTypes, SvelteFlow } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { setContext, untrack } from "svelte";
  import type { ColorMode } from "../graph";
  import {
    type GraphContext,
    type GraphControls,
    type GraphEdge,
    type GraphNode,
    type Layout,
    type Look,
    type LookFn,
    type Placement,
    type Scene,
    centersOf,
    edgeZ,
    graphContext,
    nestNodes,
    shapeOf,
    toFlowEdges,
  } from "../scene";
  import CardNode from "./CardNode.svelte";
  import ContainerNode from "./ContainerNode.svelte";
  import DotNode from "./DotNode.svelte";
  import FlowNode from "./FlowNode.svelte";
  import GraphViewport from "./GraphViewport.svelte";
  import LinkEdge from "./LinkEdge.svelte";
  import StepEdge from "./StepEdge.svelte";

  type Props = {
    scene: Scene;
    layout: Layout;
    placement: Placement;
    hover: boolean;
    frame: HTMLElement;
    selected: string | null;
    color: ColorMode;
    look: LookFn;
    onselect: (id: string | null) => void;
    onopen: (id: string) => void;
    onready: (controls: GraphControls) => void;
  };

  let { scene, layout, placement, hover, frame, selected, color, look: lookOf, onselect, onopen, onready }: Props = $props();

  let hovered = $state<string | null>(null);
  const look = $derived(lookOf(hover ? (hovered ?? selected) : selected));

  const hiddenNodes = (current: Look) => new Set(scene.nodes.filter((node) => current.hidden.has(node.id)).map((node) => node.id));
  const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((id) => b.has(id));

  // The component is remounted for every scene; afterwards only layouts, filters and dragging change these.
  // svelte-ignore state_referenced_locally
  const initialHidden = hiddenNodes(look);
  // svelte-ignore state_referenced_locally
  let nodes = $state.raw<GraphNode[]>(nestNodes(scene, layout.centers, initialHidden));
  // svelte-ignore state_referenced_locally
  let edges = $state.raw<GraphEdge[]>(toFlowEdges(scene));
  let fitSignal = $state(0);
  // svelte-ignore state_referenced_locally
  let applied = { layout, hidden: initialHidden };

  $effect(() => {
    const next = layout;
    const current = look;
    untrack(() => {
      const hidden = hiddenNodes(current);
      const moved = next !== applied.layout;
      if (moved || !sameSet(hidden, applied.hidden)) {
        const centers = moved ? new Map([...centersOf(nodes), ...next.centers]) : centersOf(nodes);
        nodes = nestNodes(scene, centers, hidden);
        if (moved && next.fit) fitSignal += 1;
        applied = { layout: next, hidden };
      }
      edges = edges.map((edge) => {
        const isHidden = current.hidden.has(edge.id) || hidden.has(edge.source) || hidden.has(edge.target);
        const raised = current.outgoing.has(edge.id) || current.incoming.has(edge.id) || current.path.has(edge.id) || selected === edge.id;
        const zIndex = raised ? edgeZ.raised : edgeZ.normal;
        return (edge.hidden ?? false) === isHidden && edge.zIndex === zIndex ? edge : { ...edge, hidden: isHidden, zIndex };
      });
    });
  });

  const shapes = $derived(new Map(nodes.map((node) => [node.id, shapeOf(node)])));

  setContext<GraphContext>(graphContext, {
    get look() {
      return look;
    },
    get selected() {
      return selected;
    },
    get color() {
      return color;
    },
    get shapes() {
      return shapes;
    },
    open: (id) => onopen(id),
  });

  const nodeTypes: NodeTypes = { card: CardNode, dot: DotNode, container: ContainerNode, flow: FlowNode };
  const edgeTypes: EdgeTypes = { link: LinkEdge, step: StepEdge };
</script>

<SvelteFlow
  bind:nodes
  bind:edges
  {nodeTypes}
  {edgeTypes}
  zIndexMode="manual"
  minZoom={0.02}
  maxZoom={4}
  colorMode="system"
  onlyRenderVisibleElements
  nodesConnectable={false}
  elementsSelectable={false}
  zoomOnDoubleClick={false}
  deleteKey={null}
  onnodeclick={({ node }) => onselect(node.id)}
  onedgeclick={({ edge }) => onselect(edge.id)}
  onpaneclick={() => onselect(null)}
  onnodepointerenter={({ node }) => {
    if (hover) hovered = node.id;
  }}
  onnodepointerleave={() => (hovered = null)}
  onnodedragstop={() => (nodes = nestNodes(scene, centersOf(nodes), applied.hidden))}
>
  <GraphViewport {placement} {fitSignal} {frame} {onready} />
</SvelteFlow>

<style>
  :global(.svelte-flow) {
    --xy-background-color: transparent;
  }

  :global(.svelte-flow__node.graph-lane) {
    pointer-events: none;
  }
</style>
