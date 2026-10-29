import { bullets, code, orNone, page } from "../markdown";
import type { Context } from "./context";

export const diagnosticsPage = (ctx: Context) => {
  const { facts, add, includedPaths } = ctx;

  const diagnostics = facts.diagnostics.filter((diagnostic) => includedPaths.has(diagnostic.file));
  add(
    "_diagnostics.md",
    page(
      `Warnings: ${diagnostics.length}`,
      "Warnings",
      bullets(
        diagnostics.map(
          (diagnostic) =>
            `${code(diagnostic.file)} line ${orNone(diagnostic.line)}, ${diagnostic.kind}: ${diagnostic.message}`,
        ),
      ),
    ),
  );
};
