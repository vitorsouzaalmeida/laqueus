import { type ForceLink, type ForceNode, forceLayout } from "./force";
import type { Point } from "./layered";

export type ForceRequest = { id: number; nodes: ForceNode[]; links: ForceLink[] };
export type ForceReply = { id: number; positions: Map<string, Point> };

addEventListener("message", (event: MessageEvent<ForceRequest>) => {
  const { id, nodes, links } = event.data;
  const reply: ForceReply = { id, positions: forceLayout(nodes, links) };
  postMessage(reply);
});
