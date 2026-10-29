import { slug } from "../../scan/parts";
import { bullets, code, factLines, page, plural, section } from "../markdown";
import type { Context } from "./context";

export const routesPages = (ctx: Context) => {
  const { facts, add, touches } = ctx;

  const routes = facts.routes.filter((route) => touches([...route.reach.client, ...route.reach.server]));
  const routePages = new Map<string, string>();
  const usedRoutes = new Map<string, number>();
  routes.forEach((route) => {
    const base = slug(route.directory) || "route";
    const count = (usedRoutes.get(base) ?? 0) + 1;
    usedRoutes.set(base, count);
    routePages.set(route.id, `_routes/${count === 1 ? base : `${base}-${count}`}.md`);
  });

  add(
    "_routes/_index.md",
    page(
      `Routes: ${routes.length}`,
      "Routes",
      bullets(
        routes.map(
          (route) =>
            `${code(route.url)} in ${code(route.directory)} (${code(routePages.get(route.id) ?? "")}): ${plural(route.files.length, "route file")}, reaches ${plural(route.reach.client.length, "client file")} and ${plural(route.reach.server.length, "server file")}`,
        ),
      ),
    ),
  );

  routes.forEach((route) => {
    const packageList = (list: typeof route.packages.client) =>
      bullets(list.map((entry) => `${code(entry.name)}: ${plural(entry.files, "file")}`));

    add(
      routePages.get(route.id) ?? "_routes/route.md",
      page(
        `Route ${route.url}: ${plural(route.files.length, "route file")} · reaches ${plural(route.reach.client.length, "client file")}, ${plural(route.reach.server.length, "server file")}`,
        `Route ${route.url}`,
        section(
          "Facts",
          factLines([
            ["URL", code(route.url)],
            ["App", code(route.app || ".")],
            ["Directory", code(route.directory)],
          ]),
        ),
        section("Route files", bullets(route.files.map((file) => `${file.role} (${file.side}): ${code(file.path)}`))),
        section("Layouts", bullets(route.layouts.map(code))),
        section("Reached on the client", bullets(route.reach.client.map(code))),
        section("Reached on the server", bullets(route.reach.server.map(code))),
        section("Packages on the client", packageList(route.packages.client)),
        section("Packages on the server", packageList(route.packages.server)),
      ),
    );
  });
};
