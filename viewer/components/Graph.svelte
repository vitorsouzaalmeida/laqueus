<script lang="ts">
  import { type NodeTypes, SvelteFlow } from "@xyflow/svelte";
  import "@xyflow/svelte/dist/style.css";
  import { setContext, untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";
  import type { ColorMode } from "../graph";
  import {
    type GraphContext,
    type GraphControls,
    type GraphEdge,
    type GraphNode,
    type Layout,
    type Look,
    type LookFn,
    type ViewPlacement,
    type Scene,
    centersOf,
    edgeZ,
    graphContext,
    markOf,
    shapeOf,
    toFlowNodes,
  } from "../scene";
  import CardNode from "./CardNode.svelte";
  import DotNode from "./DotNode.svelte";
  import EdgeLayer from "./EdgeLayer.svelte";
  import FlowNode from "./FlowNode.svelte";
  import GraphViewport from "./GraphViewport.svelte";

  type Props = {
    scene: Scene;
    layout: Layout;
    placement: ViewPlacement;
    hover: boolean;
    frame: HTMLElement;
    selected: string | null;
    color: ColorMode;
    look: LookFn;
    onselect: (id: string | null) => void;
    onopen: (id: string) => void;
    onready: (controls: GraphControls) => void;
  };

  let {
    scene,
    layout,
    placement,
    hover,
    frame,
    selected,
    color,
    look: lookOf,
    onselect,
    onopen,
    onready,
  }: Props = $props();

  let hovered = $state<string | null>(null);
  const look = $derived(lookOf(hover ? (hovered ?? selected) : selected));

  const hiddenNodes = (current: Look) =>
    new Set(scene.nodes.filter((node) => current.hidden.has(node.id)).map((node) => node.id));
  const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
    a.size === b.size && [...a].every((id) => b.has(id));
  const sameList = <T>(a: readonly T[], b: readonly T[]) =>
    a.length === b.length && a.every((item, position) => item === b[position]);

  const marks = new SvelteMap<string, number>();
  // svelte-ignore state_referenced_locally
  const ids = [...scene.nodes.map((node) => node.id), ...scene.edges.map((edge) => edge.id)];
  const writeMarks = (current: Look, selectedId: string | null) =>
    ids
      .map((id) => [id, markOf(current, selectedId, id)] as const)
      .filter(([id, flags]) => marks.get(id) !== flags)
      .forEach(([id, flags]) => marks.set(id, flags));

  // svelte-ignore state_referenced_locally
  const allEdges: GraphEdge[] = scene.edges.map((edge) => ({ ...edge, zIndex: edgeZ.normal }));
  const shownEdges = (
    current: Look,
    hidden: ReadonlySet<string>,
    selectedId: string | null,
    previous: readonly GraphEdge[],
  ) => {
    const before = new Map(previous.map((edge) => [edge.id, edge]));

    return allEdges.flatMap((edge) => {
      if (current.hidden.has(edge.id) || hidden.has(edge.source) || hidden.has(edge.target)) return [];

      const raised =
        current.outgoing.has(edge.id) ||
        current.incoming.has(edge.id) ||
        current.path.has(edge.id) ||
        selectedId === edge.id;
      const zIndex = raised ? edgeZ.raised : edgeZ.normal;
      const kept = before.get(edge.id) ?? edge;

      return [kept.zIndex === zIndex ? kept : { ...edge, zIndex }];
    });
  };

  // The component is remounted for every scene; afterwards only layouts, filters and dragging change these.
  // svelte-ignore state_referenced_locally
  untrack(() => writeMarks(look, selected));
  // svelte-ignore state_referenced_locally
  const initialHidden = hiddenNodes(look);
  // svelte-ignore state_referenced_locally
  let nodes = $state.raw<GraphNode[]>(toFlowNodes(scene, layout.centers, initialHidden));
  // svelte-ignore state_referenced_locally
  let edges = $state.raw<GraphEdge[]>(shownEdges(look, initialHidden, selected, []));
  let fitSignal = $state(0);
  // svelte-ignore state_referenced_locally
  let applied = { layout, hidden: initialHidden };

  $effect.pre(() => {
    const current = look;
    const selectedId = selected;

    untrack(() => writeMarks(current, selectedId));
  });

  $effect(() => {
    const next = layout;
    const current = look;
    const selectedId = selected;

    untrack(() => {
      const hidden = hiddenNodes(current);
      const moved = next !== applied.layout;

      if (moved || !sameSet(hidden, applied.hidden)) {
        const centers = moved ? new Map([...centersOf(nodes), ...next.centers]) : centersOf(nodes);
        nodes = toFlowNodes(scene, centers, hidden);
        if (moved && next.fit) fitSignal += 1;
        applied = { layout: next, hidden };
      }

      const shown = shownEdges(current, hidden, selectedId, edges);
      if (!sameList(shown, edges)) edges = shown;
    });
  });

  const shapes = $derived(new Map(nodes.map((node) => [node.id, shapeOf(node)])));
  const centers = $derived(centersOf(nodes));

  setContext<GraphContext>(graphContext, {
    mark: (id) => marks.get(id) ?? 0,
    get color() {
      return color;
    },
    get shapes() {
      return shapes;
    },
    select: (id) => onselect(id),
    open: (id) => onopen(id),
  });

  const nodeTypes: NodeTypes = { card: CardNode, dot: DotNode, flow: FlowNode };
</script>

<SvelteFlow
  bind:nodes
  {nodeTypes}
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
  onpaneclick={() => onselect(null)}
  onnodepointerenter={({ node }) => {
    if (hover) hovered = node.id;
  }}
  onnodepointerleave={() => (hovered = null)}
>
  <EdgeLayer {edges} {centers} />
  <GraphViewport {placement} {fitSignal} {frame} {onready} />
</SvelteFlow>

<style>
  :global(.svelte-flow) {
    --xy-background-color: transparent;
  }
</style>
