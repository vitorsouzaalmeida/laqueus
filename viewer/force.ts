import { type SimulationNodeDatum, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { Point } from "./layered";

export type ForceNode = { id: string; cluster?: string | null };
export type ForceLink = { from: string; to: string };

type Body = SimulationNodeDatum & { id: string; cluster: string | null };

/** Pulls members of the same cluster (a folder) towards each other, so container boxes stay compact. */
const clusterForce = (strength: number) => {
  const state = { bodies: [] as Body[] };
  const force = (alpha: number) => {
    const centres = state.bodies.reduce((map, body) => {
      if (body.cluster === null) return map;
      const sum = map.get(body.cluster) ?? { x: 0, y: 0, count: 0 };
      return map.set(body.cluster, { x: sum.x + (body.x ?? 0), y: sum.y + (body.y ?? 0), count: sum.count + 1 });
    }, new Map<string, { x: number; y: number; count: number }>());
    state.bodies.forEach((body) => {
      const centre = body.cluster === null ? undefined : centres.get(body.cluster);
      if (!centre || centre.count < 2) return;
      body.vx = (body.vx ?? 0) + (centre.x / centre.count - (body.x ?? 0)) * strength * alpha;
      body.vy = (body.vy ?? 0) + (centre.y / centre.count - (body.y ?? 0)) * strength * alpha;
    });
  };
  force.initialize = (bodies: Body[]) => {
    state.bodies = bodies;
  };
  return force;
};

/** A deterministic force-directed layout; positions are node centres. */
export const forceLayout = (nodes: readonly ForceNode[], links: readonly ForceLink[]): Map<string, Point> => {
  const bodies: Body[] = nodes.map((node) => ({ id: node.id, cluster: node.cluster ?? null }));
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
    .force("cluster", clusterForce(0.35))
    .stop();
  simulation.tick(Math.ceil(Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())));
  return new Map(bodies.map((body) => [body.id, { x: body.x ?? 0, y: body.y ?? 0 }]));
};
