import { byText } from "../../model";
import { bullets, code, page, plural } from "../markdown";
import type { Context } from "./context";

export const filesPage = (ctx: Context) => {
  const { add, modules, partOf, filePageOf } = ctx;

  const filed = modules.toSorted((a, b) => byText(a.path, b.path));
  add(
    "_files.md",
    page(
      `Files: ${plural(filed.length, "source file")} on ${plural(new Set(filed.map((module) => partOf(module.id))).size, "part page")}`,
      "Files",
      "Every scanned source file with the part page that describes it. Find a file with `grep 'src/lib/x.ts' _files.md`.",
      bullets(filed.map((module) => `${code(module.path)} → ${filePageOf(module.path)}`)),
    ),
  );
};
