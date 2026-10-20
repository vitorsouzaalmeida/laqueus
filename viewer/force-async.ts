import { type ForceLink, type ForceNode, forceLayout } from "./force";
import type { ForceReply, ForceRequest } from "./force-worker";
import type { Point } from "../src/model";

const workerFrom = 150;

type Waiting = { request: ForceRequest; resolve: (positions: Map<string, Point>) => void };

/** `worker` is undefined until first use and null once workers turn out to be unavailable. */
const pool: { worker: Worker | null | undefined; next: number; waiting: Map<number, Waiting> } = {
  worker: undefined,
  next: 0,
  waiting: new Map(),
};

const inline = (request: ForceRequest) => forceLayout(request.nodes, request.links);

const giveUp = () => {
  pool.worker?.terminate();
  pool.worker = null;
  pool.waiting.forEach(({ request, resolve }) => resolve(inline(request)));
  pool.waiting.clear();
};

const spawn = (): Worker | null => {
  try {
    return new Worker(new URL("./force-worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
};

const settle = (event: MessageEvent<ForceReply>) => {
  pool.waiting.get(event.data.id)?.resolve(event.data.positions);
  pool.waiting.delete(event.data.id);
};

const workerOf = (): Worker | null => {
  if (pool.worker !== undefined) return pool.worker;

  const worker = spawn();

  worker?.addEventListener("message", settle);
  worker?.addEventListener("error", giveUp);
  pool.worker = worker;

  return worker;
};

export const forceLayoutAsync = (
  nodes: readonly ForceNode[],
  links: readonly ForceLink[],
): Promise<Map<string, Point>> => {
  const request: ForceRequest = { id: pool.next, nodes: [...nodes], links: [...links] };
  pool.next += 1;
  const worker = nodes.length < workerFrom || typeof Worker === "undefined" ? null : workerOf();

  if (!worker) return Promise.resolve(inline(request));

  return new Promise((resolve) => {
    pool.waiting.set(request.id, { request, resolve });
    worker.postMessage(request);
  });
};
