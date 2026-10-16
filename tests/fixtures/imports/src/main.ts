import type { Shape } from "./types";
import { type Other } from "./types-two";
import { helper } from "./helper.js";
import { secondHelper } from "./helper.js";
import Button from "./Button.svelte";
import "./styles.css";
import external from "external-package";
import { aliased } from "@/aliased";
import { missing } from "./does-not-exist";
export * from "./reexported";
export { thing } from "./named-reexport";
export type { Kind } from "./type-reexport";

const lazy = () => import("./lazy");
const legacy = require("./legacy.js");

export const main = (shape: Shape, other: Other) =>
  [helper, secondHelper, Button, external, aliased, missing, lazy, legacy, shape, other];
