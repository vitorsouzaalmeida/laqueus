import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeParsedFile, analyzeProject, parseSource } from "../src/analyze";
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
  snapshot.dependencyEdges
    .map((edge) => `${edge.from.replace("module:", "")} -> ${edge.to.replace("module:", "")}`)
    .toSorted();
