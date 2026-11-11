import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeParsedFile } from "../src/language/file";
import { parseSource } from "../src/language/parse";
import { analyzeProject } from "../src/scan/project";
import type { GraphSnapshot } from "../src/model";

export const fixture = (name: string) => path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", name);

export const scan = async (root: string): Promise<GraphSnapshot> => {
  const result = await analyzeProject(root);

  if (!result.ok) throw new Error(result.error);

  return result.value;
};

export const analyzeCode = (fileName: string, code: string) => {
  const parsed = parseSource("/virtual", `/virtual/${fileName}`, code);

  if (!parsed.ok) throw new Error(parsed.error.message);

  return analyzeParsedFile(parsed.value);
};

export const edgePairs = (snapshot: GraphSnapshot) =>
  snapshot.dependencyEdges.map((edge) => `${edge.from.replace("", "")} -> ${edge.to.replace("", "")}`).toSorted();

export const withProject = async <T>(
  files: Readonly<Record<string, string>>,
  run: (root: string) => Promise<T> | T,
): Promise<T> => {
  const root = await mkdtemp(path.join(tmpdir(), "laqueus-test-"));

  try {
    await Promise.all(
      Object.entries(files).map(async ([file, content]) => {
        const target = path.join(root, file);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
      }),
    );
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
};

export const kitPackage = JSON.stringify({ devDependencies: { "@sveltejs/kit": "^2.0.0" } });
