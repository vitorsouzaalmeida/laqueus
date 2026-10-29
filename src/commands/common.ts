import { parseArgs } from "node:util";
import { type GraphSnapshot, type Result, err, errorMessage, ok } from "../model";
import { analyzeProject } from "../scan/project";

export type Io = {
  cwd: string;
  out: (text: string) => void;
  log: (line: string) => void;
  now: () => Date;
};

export type ParseArgsConfig = NonNullable<Parameters<typeof parseArgs>[0]>;

export const parse = <const T extends ParseArgsConfig["options"]>(argv: readonly string[], options: T) => {
  try {
    return ok(parseArgs({ args: [...argv], allowPositionals: true, options }));
  } catch (error) {
    return err(errorMessage(error));
  }
};

export const summary = (snapshot: GraphSnapshot) => {
  const cycles = new Set(
    snapshot.modules.flatMap((module) => (module.metrics.cycleGroup === null ? [] : [module.metrics.cycleGroup])),
  ).size;
  return [
    `${snapshot.modules.length} files`,
    `${snapshot.dependencyEdges.length} import edges`,
    `${cycles} cycles`,
    `${snapshot.functions.length} functions`,
    `${snapshot.callEdges.length} local call edges`,
    `${snapshot.diagnostics.length} warnings`,
  ].join(", ");
};

export const scan = async (root: string, log: (line: string) => void): Promise<Result<GraphSnapshot>> => {
  log(`Scanning ${root} ...`);
  const result = await analyzeProject(root);

  if (result.ok) log(`Scanned in ${result.value.durationMs} ms: ${summary(result.value)}`);

  return result;
};
