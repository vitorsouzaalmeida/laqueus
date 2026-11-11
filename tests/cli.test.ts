import { execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli";
import type { Io } from "../src/commands/common";
import { outputFor, parseExportArgs } from "../src/commands/export";
import { parseListArgs } from "../src/commands/list";
import { type Baseline, followRenames } from "../src/report/check";
import { markerFile } from "../src/report/write";
import { fixture, withProject } from "./helpers";

const fakeIo = (cwd: string) => {
  const output: string[] = [];
  const logs: string[] = [];
  const io: Io = {
    cwd,
    out: (text) => output.push(text),
    log: (line) => logs.push(line),
    now: () => new Date("2026-10-20T12:00:00.000Z"),
  };

  return { io, stdout: () => output.join(""), logs };
};

describe("cli arguments", () => {
  it("prints the usage without a command and refuses an unknown one", async () => {
    const help = fakeIo("/work");
    const unknown = fakeIo("/work");

    await expect(main([], "/work", help.io)).resolves.toBe(0);
    expect(help.stdout()).toContain("Usage: laqueus list");
    expect(help.stdout()).toContain("Usage: laqueus export");
    await expect(main(["serve"], "/work", unknown.io)).resolves.toBe(1);
    expect(unknown.logs[0]).toContain("Unknown command: serve");
  });

  it("takes the part as its argument and the project from -C", () => {
    expect(parseExportArgs([], "/work")).toEqual({
      ok: true,
      value: { root: "/work", part: "", output: null, logic: true, help: false },
    });
    expect(parseExportArgs(["server/src-lib/", "-C", "app", "-o", "out", "--no-logic"], "/work")).toEqual({
      ok: true,
      value: { root: "/work/app", part: "server/src-lib", output: "/work/out", logic: false, help: false },
    });
    expect(parseExportArgs(["a", "b"], "/work").ok).toBe(false);
    expect(parseExportArgs(["--node", "root"], "/work").ok).toBe(false);
    expect(parseListArgs(["server", "-C", "app"], "/work")).toEqual({
      ok: true,
      value: { root: "/work/app", part: "server", help: false },
    });
  });

  it("names the default output after the part", () => {
    expect(outputFor("/work", "")).toBe("/work/.laqueus");
    expect(outputFor("/work", "server/src-lib")).toBe("/work/.laqueus-server-src-lib");
  });
});

describe("laqueus export", () => {
  let directory = "";

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "laqueus-export-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("writes the context directory and marks it", async () => {
    const { io, logs } = fakeIo(directory);
    const target = path.join(directory, "ctx");

    await expect(main(["export", "-C", fixture("sveltekit-sides"), "-o", target], directory, io)).resolves.toBe(0);

    const entries = await readdir(target);
    expect(entries).toEqual(
      expect.arrayContaining(["_index.md", "_files.md", "_health.md", "client", "shared", "server", markerFile]),
    );
    expect(entries).not.toContain("src");
    expect(await readFile(path.join(target, "_index.md"), "utf8")).toContain("- Exported: 2026-10-20T12:00:00.000Z");
    expect(await readFile(path.join(target, "server/src-lib.md"), "utf8")).toContain("### `src/lib/server/db.ts`");
    expect(logs.join("\n")).toContain("start at");
  });

  it("replaces the previous export, dropping pages of deleted files", async () => {
    const project = path.join(directory, "project");
    await cp(fixture("topology"), project, { recursive: true });
    const { io } = fakeIo(directory);

    await expect(main(["export", "-C", project], directory, io)).resolves.toBe(0);
    expect(await readFile(path.join(project, ".laqueus/_files.md"), "utf8")).toContain("`src/lone.ts`");

    await rm(path.join(project, "src/lone.ts"));

    await expect(main(["export", "-C", project], directory, io)).resolves.toBe(0);
    expect(await readFile(path.join(project, ".laqueus/_files.md"), "utf8")).not.toContain("`src/lone.ts`");
  });

  it("refuses to replace a directory it did not write", async () => {
    const target = path.join(directory, "notes");
    await mkdir(target);
    await writeFile(path.join(target, "keep.md"), "mine\n");
    const { io, logs } = fakeIo(directory);

    await expect(main(["export", "-C", fixture("topology"), "-o", target], directory, io)).resolves.toBe(1);
    expect(await readdir(target)).toEqual(["keep.md"]);
    expect(logs.at(-1)).toContain("was not written by laqueus export");
  });

  it("leaves the CC breakdown out with --no-logic", async () => {
    const project = path.join(directory, "project");
    const target = path.join(directory, "ctx");
    const { io } = fakeIo(directory);
    const branches = Array.from({ length: 11 }, (_, index) => `  if (n === ${index}) return ${index};`).join("\n");

    await cp(fixture("topology"), project, { recursive: true });
    await writeFile(
      path.join(project, "src/rules.ts"),
      `export const pick = (n: number) => {\n${branches}\n  return -1;\n};\n`,
    );

    const partPage = async () => {
      const files = await readFile(path.join(target, "_files.md"), "utf8");
      const page = /^- `src\/rules\.ts` → `([^`]+)`$/m.exec(files)?.[1] ?? "";
      return readFile(path.join(target, page), "utf8");
    };

    await expect(main(["export", "-C", project, "-o", target], directory, io)).resolves.toBe(0);
    expect(await partPage()).toContain("- Decisions: 11\n  - line 2 (+1, if)");

    await expect(main(["export", "-C", project, "-o", target, "--no-logic"], directory, io)).resolves.toBe(0);
    expect(await partPage()).toContain("- Decisions: 11\n- Ways out: not included");
  });

  it("prints its usage", async () => {
    const { io, stdout } = fakeIo(directory);

    await expect(main(["export", "--help"], directory, io)).resolves.toBe(0);
    expect(stdout()).toContain("Usage: laqueus export");
  });

  it("exports one part into its own directory", async () => {
    const project = path.join(directory, "project");
    await cp(fixture("sveltekit-sides"), project, { recursive: true });
    const { io } = fakeIo(directory);

    await expect(main(["export", "server", "-C", project], directory, io)).resolves.toBe(0);

    const target = path.join(project, ".laqueus-server");
    const start = await readFile(path.join(target, "_index.md"), "utf8");

    expect(start).toContain("- Scope: server");
    expect(await readdir(path.join(target, "server"))).toEqual(["_index.md", "src-lib.md"]);
    expect(await readdir(target)).not.toContain("client");
  });

  it("refuses an unknown part before scanning logic", async () => {
    const { io, logs } = fakeIo(directory);

    await expect(main(["export", "nope", "-C", fixture("topology")], directory, io)).resolves.toBe(1);
    expect(logs.at(-1)).toContain('No part "nope"');
    expect(logs.at(-1)).toContain("laqueus list");
  });
});

const listed = async (args: readonly string[]) => {
  const { io, stdout, logs } = fakeIo(process.cwd());
  const code = await main(["list", ...args, "-C", fixture("sveltekit-sides")], process.cwd(), io);
  return { code, stdout: stdout(), logs };
};

describe("laqueus list", () => {
  it("starts with the sides, one per line, the hidden ones last", async () => {
    const { code, stdout } = await listed([]);

    expect(code).toBe(0);
    expect(stdout).toBe("client\nshared\nserver\nunreached\ntooling\n");
  });

  it("lists the areas inside a side", async () => {
    const { stdout, logs } = await listed(["server"]);

    expect(stdout).toBe("server/src-lib\n");
    expect(logs.at(-1)).toContain("laqueus export <part>");
  });

  it("lists the files of a part with no sub-parts", async () => {
    const { stdout, logs } = await listed(["server/src-lib"]);

    expect(stdout.split("\n")).toContain("src/lib/server/db.ts");
    expect(logs.at(-1)).toContain("laqueus export server/src-lib");
  });

  it("names the valid parts when one does not exist", async () => {
    const { code, stdout, logs } = await listed(["server/nope"]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(logs.at(-1)).toBe('No part "server/nope". Inside server: server/src-lib.');
  });
});

describe("laqueus file", () => {
  const project = fixture("sveltekit-sides");

  it("prints the facts of a file with its part and its side", async () => {
    const { io, stdout } = fakeIo(project);

    await expect(main(["file", "src/lib/server/db.ts"], project, io)).resolves.toBe(0);
    expect(stdout().split("\n")[0]).toBe(
      "src/lib/server/db.ts: Server only · part server/src-lib · fan-in 4 · fan-out 0 · max CC 1 · no cycle",
    );
    expect(stdout()).toContain("### `src/lib/server/db.ts`");
    expect(stdout()).toContain("- Part: `server/src-lib` (Server only › src / lib)");
    expect(stdout()).toContain("- Reached on the server: `src/hooks.server.ts` → `src/lib/server/db.ts`");
    expect(stdout()).toContain("- Imported by: 4");
  });

  it("takes paths from the current directory or from the project", async () => {
    const inside = fakeIo(path.join(project, "src", "lib"));
    const outside = fakeIo(tmpdir());

    await expect(main(["file", "server/db.ts", "-C", project], inside.io.cwd, inside.io)).resolves.toBe(0);
    await expect(main(["file", "src/lib/format.ts", "-C", project], outside.io.cwd, outside.io)).resolves.toBe(0);
    expect(inside.stdout()).toContain("### `src/lib/server/db.ts`");
    expect(outside.stdout()).toContain("### `src/lib/format.ts`");
  });

  it("prints the files it finds and says which ones are not in the scan", async () => {
    const { io, stdout, logs } = fakeIo(project);

    await expect(main(["file", "src/lib/format.ts", "src/lib/format.test.ts"], project, io)).resolves.toBe(1);
    expect(stdout()).toContain("### `src/lib/format.ts`");
    expect(logs.at(-1)).toContain("src/lib/format.test.ts is not in the scan");
  });
});

const tangled = (extra: string) =>
  [
    "export const tangled = (a: number, b: number) => {",
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => `  if (a > ${n} && b > ${n}) return ${n};`),
    extra,
    "  return 0;",
    "};",
  ].join("\n");

const cycleFiles = {
  "src/a.ts": 'import { b } from "./b";\nexport const a = () => b;',
  "src/b.ts": 'import { a } from "./a";\nexport const b = () => a;',
};

const checked = async (root: string, ...args: readonly string[]) => {
  const { io, stdout, logs } = fakeIo(root);
  const code = await main(["check", ...args], root, io);

  return { code, stdout: stdout(), logs };
};

describe("laqueus check", () => {
  it("needs a baseline, saves one, and passes while nothing changes", async () => {
    await withProject({ "src/a.ts": "export const a = 1;" }, async (root) => {
      const first = await checked(root);

      expect(first.code).toBe(2);
      expect(first.logs.at(-1)).toContain("laqueus check --update");

      expect((await checked(root, "--update")).code).toBe(0);
      expect(JSON.parse(await readFile(path.join(root, ".laqueus-baseline.json"), "utf8"))).toMatchObject({
        version: 1,
        cycles: [],
        warnings: [],
        highCc: [],
      });

      const again = await checked(root);

      expect(again.code).toBe(0);
      expect(again.stdout.split("\n")[0]).toContain("Check: 0 new problems, 0 fixed");
    });
  });

  it("fails on a new cycle, a new warning and a function entering the high band", async () => {
    await withProject({ "src/a.ts": "export const a = 1;", "src/b.ts": "export const b = 1;" }, async (root) => {
      await checked(root, "--update");
      await writeFile(path.join(root, "src/a.ts"), cycleFiles["src/a.ts"]);
      await writeFile(path.join(root, "src/b.ts"), `${cycleFiles["src/b.ts"]}\nimport "./missing";\n${tangled("")}`);

      const { code, stdout } = await checked(root);

      expect(code).toBe(1);
      expect(stdout).toContain(
        "- New cycle of 2 files: `src/a.ts`, `src/b.ts`. Smallest cut: `src/a.ts` → `src/b.ts` (line 1: `b`).",
      );
      expect(stdout).toContain('- New warning: `src/b.ts` line 3, unresolved-import: Cannot resolve "./missing"');
      expect(stdout).toContain("- High CC: `tangled` in `src/b.ts` (line 4) is CC 17, new in the high band (16+).");
    });
  });

  it("fails when a cycle grows or a high function gets worse", async () => {
    await withProject({ ...cycleFiles, "src/c.ts": tangled("") }, async (root) => {
      await checked(root, "--update");
      await writeFile(
        path.join(root, "src/a.ts"),
        'import { b } from "./b";\nimport { c } from "./c";\nexport const a = () => [b, c];',
      );
      await writeFile(
        path.join(root, "src/c.ts"),
        `import { a } from "./a";\nexport const c = () => a;\n${tangled("  if (a < 0 || b < 0) return -1;")}`,
      );

      const { code, stdout } = await checked(root);

      expect(code).toBe(1);
      expect(stdout).toContain("- Cycle grew to 3 files: `src/c.ts` joined `src/a.ts`, `src/b.ts`.");
      expect(stdout).toContain("- High CC: `tangled` in `src/c.ts` (line 3) is CC 19, was 17.");
    });
  });

  it("lists what was fixed and still passes", async () => {
    await withProject({ ...cycleFiles, "src/c.ts": tangled("") }, async (root) => {
      await checked(root, "--update");
      await writeFile(path.join(root, "src/b.ts"), "export const b = () => 1;");
      await writeFile(path.join(root, "src/c.ts"), "export const tangled = (a: number) => a;");

      const { code, stdout } = await checked(root);

      expect(code).toBe(0);
      expect(stdout).toContain("- Cycle gone: `src/a.ts`, `src/b.ts`.");
      expect(stdout).toContain("- CC lower: `tangled` in `src/c.ts` left the high band, was 17.");
      expect(stdout).toContain("Keep these with `laqueus check --update`.");
    });
  });

  it("keeps the baseline where --baseline says, and refuses one it cannot read", async () => {
    await withProject({ "project/src/a.ts": "export const a = 1;", "bad.json": "{}" }, async (root) => {
      const project = path.join(root, "project");
      const baseline = path.join(root, "baselines", "project.json");

      expect((await checked(project, "--update", "--baseline", baseline)).code).toBe(0);
      expect(await readdir(project)).toEqual(["src"]);
      expect((await checked(project, "--baseline", baseline)).code).toBe(0);

      const bad = await checked(project, "--baseline", path.join(root, "bad.json"));

      expect(bad.code).toBe(2);
      expect(bad.logs.at(-1)).toContain("Cannot read the baseline");
    });
  });
});

const git = (root: string, ...args: readonly string[]) =>
  execFileSync(
    "git",
    ["-C", root, "-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", ...args],
    { env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" }, stdio: "pipe" },
  );

const committed = (root: string) => {
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
};

describe("laqueus check in a git repository", () => {
  it("follows files that git says were renamed", async () => {
    await withProject({ ...cycleFiles, "src/c.ts": tangled("") }, async (root) => {
      committed(root);
      await checked(root, "--update");
      git(root, "mv", "src/a.ts", "src/first.ts");
      git(root, "mv", "src/c.ts", "src/moved.ts");
      await writeFile(path.join(root, "src/b.ts"), 'import { a } from "./first";\nexport const b = () => a;');

      const { code, stdout } = await checked(root);

      expect(stdout.split("\n")[0]).toMatch(
        /^Check: 0 new problems, 0 fixed, against the baseline of \S+ at [0-9a-f]{8}, 2 renamed files followed$/,
      );
      expect(code).toBe(0);
    });
  });

  it("follows renames when the project is a folder inside the repository", async () => {
    await withProject({ "apps/web/src/c.ts": tangled(""), "apps/api/src/c.ts": tangled("") }, async (root) => {
      const project = path.join(root, "apps", "web");

      committed(root);
      await checked(project, "--update");
      git(root, "mv", "apps/web/src/c.ts", "apps/web/src/moved.ts");
      git(root, "mv", "apps/api/src/c.ts", "apps/api/src/elsewhere.ts");

      const { code, stdout } = await checked(project);

      expect(stdout.split("\n")[0]).toContain("0 new problems, 0 fixed");
      expect(stdout.split("\n")[0]).toContain("1 renamed file followed");
      expect(code).toBe(0);
    });
  });

  it("still reports what got worse in a renamed file", async () => {
    await withProject({ "src/c.ts": tangled("") }, async (root) => {
      committed(root);
      await checked(root, "--update");
      git(root, "mv", "src/c.ts", "src/moved.ts");
      await writeFile(path.join(root, "src/moved.ts"), tangled("  if (a < 0 || b < 0) return -1;"));

      const { code, stdout } = await checked(root);

      expect(code).toBe(1);
      expect(stdout).toContain("- High CC: `tangled` in `src/moved.ts` (line 1) is CC 19, was 17.");
    });
  });

  it("compares paths as they are when git does not have the baseline's commit", async () => {
    await withProject({ "src/a.ts": "export const a = 1;" }, async (root) => {
      committed(root);
      await checked(root, "--update");

      const file = path.join(root, ".laqueus-baseline.json");
      const saved = await readFile(file, "utf8");

      expect(saved).toMatch(/"commit": "[0-9a-f]{40,64}"/);
      await writeFile(file, saved.replace(/"commit": "[0-9a-f]+"/, `"commit": "${"0123456789".repeat(4)}"`));

      const { code, logs } = await checked(root);

      expect(code).toBe(0);
      expect(logs.at(-1)).toContain("renamed files are not followed");
    });
  });

  it("refuses a baseline whose commit is not a hash", async () => {
    await withProject({ "src/a.ts": "export const a = 1;" }, async (root) => {
      await checked(root, "--update");

      const file = path.join(root, ".laqueus-baseline.json");

      await writeFile(file, (await readFile(file, "utf8")).replace('"commit": null', '"commit": "--output=x"'));

      const { code, logs } = await checked(root);

      expect(code).toBe(2);
      expect(logs.at(-1)).toContain("its commit is not a commit hash");
    });
  });

  it("follows two files that swapped names", () => {
    const baseline: Baseline = {
      version: 1,
      createdAt: "2026-11-11T00:00:00.000Z",
      commit: null,
      cycles: [["a.ts", "c.ts"]],
      warnings: [],
      highCc: [
        { file: "a.ts", name: "f", cc: 20 },
        { file: "b.ts", name: "g", cc: 18 },
      ],
    };
    const swapped = followRenames(
      baseline,
      new Map([
        ["a.ts", "b.ts"],
        ["b.ts", "a.ts"],
        ["z.ts", "y.ts"],
      ]),
    );

    expect(swapped.baseline.cycles).toEqual([["b.ts", "c.ts"]]);
    expect(swapped.baseline.highCc.map((fn) => fn.file)).toEqual(["b.ts", "a.ts"]);
    expect(swapped.followed).toBe(2);
  });
});
