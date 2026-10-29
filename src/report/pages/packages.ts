import { byText } from "../../model";
import { bullets, code, factLines, page, plural, section } from "../markdown";
import type { Context } from "./context";

export const packagesPage = (ctx: Context) => {
  const { facts, add, modules } = ctx;

  const allPackages = facts.packages(modules.map((module) => module.id));
  add(
    "_packages.md",
    page(
      `External packages: ${plural(allPackages.length, "package")}`,
      "External packages",
      ...(allPackages.length === 0
        ? ["none"]
        : allPackages.map((entry) =>
            section(
              code(entry.name),
              `${factLines([["Files", entry.files]])}\n${bullets(
                modules
                  .filter((module) => module.externals.includes(entry.name))
                  .map((module) => code(module.path))
                  .toSorted(byText),
              )}`,
            ),
          )),
    ),
  );
};
