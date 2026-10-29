import { definitions } from "../prose";
import { page, section } from "../markdown";
import type { Context } from "./context";

export const definitionsPage = (ctx: Context) => {
  const { add, kit } = ctx;

  add(
    "_definitions.md",
    page(
      "Definitions: what each label in this export counts",
      "Definitions",
      ...definitions(kit).map(([label, text]) => section(label, text)),
    ),
  );
};
