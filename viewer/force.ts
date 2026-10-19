import { type SimulationNodeDatum, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Point } from "./layered";

export type ForceNode = { id: string };
export type ForceLink = { from: string; to: string };

type Body = SimulationNodeDatum & { id: string };

/** A deterministic force-directed layout; positions are node centres. */
export const forceLayout = (nodes: readonly ForceNode[], links: readonly ForceLink[]): Map<string, Point> => {
  const bodies: Body[] = nodes.map((node) => ({ id: node.id }));
  const ids = new Set(bodies.map((body) => body.id));
  const edges = links
    .filter((link) => link.from !== link.to && ids.has(link.from) && ids.has(link.to))
    .map((link) => ({ source: link.from, target: link.to }));
  const simulation = forceSimulation(bodies)
    .force("link", forceLink<Body, { source: string; target: string }>(edges).id((body) => body.id).distance(90))
    .force("charge", forceManyBody().strength(-320))
    .force("collide", forceCollide(62))
    .force("x", forceX(0).strength(0.05))
    .force("y", forceY(0).strength(0.05))
    .stop();
  simulation.tick(Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())));
  return new Map(bodies.map((body) => [body.id, { x: body.x ?? 0, y: body.y ?? 0 }]));
};
