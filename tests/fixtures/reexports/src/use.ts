import type { Shape } from "./shapes";
import { make } from "./shapes";

let last: import("./types").Shape | null = null;

export const remember = (shape: Shape) => {
  last = shape;
  return make(last.side);
};
