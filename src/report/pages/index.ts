import type { Result } from "../../model";
import { err, ok } from "../../model";
import type { Tree } from "../../scan/parts";
import type { Facts } from "../facts";
import type { Pages } from "../write";
import { areasPage } from "./areas";
import { type PageOptions, checkScope, pageContext } from "./context";
import { cyclesPage } from "./cycles";
import { definitionsPage } from "./definitions";
import { diagnosticsPage } from "./diagnostics";
import { filesPage } from "./files";
import { findingsPage } from "./findings";
import { healthPage } from "./health";
import { homePage } from "./home";
import { packagesPage } from "./packages";
import { partPages } from "./parts";
import { routesPages } from "./routes";

export const buildPages = (facts: Facts, tree: Tree, options: PageOptions): Result<Pages> => {
  const scope = checkScope(tree, options);

  if (!scope.ok) return scope;

  const pages: Pages = new Map();
  const collisions: string[] = [];
  const ctx = pageContext(facts, tree, options, (path, content) => {
    if (pages.has(path)) collisions.push(path);
    pages.set(path, content);
  });

  partPages(ctx);
  filesPage(ctx);
  cyclesPage(ctx);
  packagesPage(ctx);
  diagnosticsPage(ctx);
  if (ctx.kit) routesPages(ctx);
  areasPage(ctx);
  healthPage(ctx);
  findingsPage(ctx);
  definitionsPage(ctx);
  homePage(ctx);

  return collisions.length > 0
    ? err(`Two pages would be written to the same path: ${[...new Set(collisions)].join(", ")}`)
    : ok(pages);
};
