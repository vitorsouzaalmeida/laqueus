import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { type Result, err, errorMessage, ok } from "../model";
import type { Pages } from "./pages";

export const markerFile = ".laqueus-context";

const markerText = "Written by laqueus export. The whole directory is replaced on every export.\n";

const writeAll = async (directory: string, pages: Pages) => {
  await Promise.all(
    [...pages].map(async ([page, content]) => {
      const target = path.join(directory, page);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }),
  );
  await writeFile(path.join(directory, markerFile), markerText);
};

export const writeContext = async (target: string, pages: Pages): Promise<Result<string>> => {
  const info = await stat(target).catch(() => null);

  if (info && !info.isDirectory()) return err(`${target} exists and is not a directory.`);

  const existing = info ? await readdir(target) : [];

  if (existing.length > 0 && !existing.includes(markerFile)) {
    return err(`${target} is not empty and was not written by laqueus export. Pass another -o or remove it first.`);
  }

  await mkdir(path.dirname(target), { recursive: true });
  const staging = await mkdtemp(`${target}.tmp-`);

  try {
    await writeAll(staging, pages);
    if (info) await rm(target, { recursive: true, force: true });
    await rename(staging, target);
    return ok(target);
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    return err(`Could not write ${target}: ${errorMessage(error)}`);
  }
};
