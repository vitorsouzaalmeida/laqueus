import { Gamma, alpha, beta } from "./lib";
import * as everything from "./lib";

export const run = () => alpha() + beta() + Gamma() + Object.keys(everything).length;
