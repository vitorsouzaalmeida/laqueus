import { type ModuleGroup, type Side, directoryOf } from "../model";

const minimumGroupSize = 4;

const parentDirectory = (directory: string) => (directory.includes("/") ? directoryOf(directory) : ".");

const directoryDepth = (directory: string) => (directory === "." ? 0 : directory.split("/").length);

export const groupDirectories = (files: readonly string[]): Map<string, string> => {
  const initial = new Map(files.map((file) => [file, directoryOf(file)]));
  const directories = [...new Set(initial.values())].toSorted(
    (a, b) => directoryDepth(b) - directoryDepth(a) || a.localeCompare(b),
  );

  return directories.reduce((assignment, directory) => {
    const members = [...assignment].filter(([, assigned]) => assigned === directory);
    return members.length >= minimumGroupSize || directory === "."
      ? assignment
      : members.reduce((next, [file]) => next.set(file, parentDirectory(directory)), assignment);
  }, initial);
};

export const folderGroups = (
  paths: readonly string[],
  sideOf: (file: string) => Side,
  sides: readonly Side[],
): { groups: ModuleGroup[]; groupOf: Map<string, string> } => {
  const groups = sides.flatMap((side) => {
    const files = paths.filter((file) => sideOf(file) === side);
    const assignment = groupDirectories(files);

    return [...new Set(assignment.values())].map((directory) => ({
      id: `group:${side}:${directory}`,
      side,
      directory,
      moduleIds: files.filter((file) => assignment.get(file) === directory),
    }));
  });

  return { groups, groupOf: new Map(groups.flatMap((group) => group.moduleIds.map((id) => [id, group.id] as const))) };
};
