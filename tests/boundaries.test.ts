import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");

const sourceFiles = async () =>
  (await readdir(source, { recursive: true }))
    .filter((file) => file.endsWith(".ts"))
    .map((file) => file.split(path.sep).join("/"))
    .toSorted();

const contentOf = (file: string) => readFile(path.join(source, file), "utf8");

describe("module boundaries", () => {
  it("keeps SvelteKit details in the SvelteKit module, the model and the prose", async () => {
    const allowed = new Set(["scan/sveltekit.ts", "model.ts", "report/prose.ts"]);
    const files = await sourceFiles();
    const leaking = (
      await Promise.all(
        files.map(async (file) => {
          const code = (await contentOf(file)).replace(/from "[^"]*"/g, "");
          return /sveltekit|\$lib|\+page|\+layout/i.test(code) ? [file] : [];
        }),
      )
    )
      .flat()
      .filter((file) => !allowed.has(file));

    expect(leaking).toEqual([]);
  });

  it("keeps the graph algorithms free of syntax trees", async () => {
    const files = (await sourceFiles()).filter((file) => file.startsWith("graph/"));
    const importing = (
      await Promise.all(
        files.map(async (file) =>
          /from "(@typescript-eslint|\.\.\/language)/.test(await contentOf(file)) ? [file] : [],
        ),
      )
    ).flat();

    expect(files.length).toBeGreaterThan(0);
    expect(importing).toEqual([]);
  });
});
