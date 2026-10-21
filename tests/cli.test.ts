import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "../src/cli";
import { type Io, outputFor, parseExportArgs } from "../src/commands/export";
import { parseListArgs } from "../src/commands/list";
import { parseServeArgs } from "../src/commands/serve";
import { markerFile } from "../src/context/write";
import { fixture } from "./helpers";

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
  it("parses serve options as before", () => {
    expect(parseServeArgs(["app", "--no-open", "--port", "0"], "/work")).toEqual({
      ok: true,
      value: { root: "/work/app", open: false, port: 0, help: false },
    });
    expect(parseServeArgs(["--port", "99999"], "/work").ok).toBe(false);
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

    await expect(
      main(["export", "-C", fixture("sveltekit-sides"), "-o", target], directory, undefined, io),
    ).resolves.toBe(0);

    const entries = await readdir(target);
    expect(entries).toEqual(expect.arrayContaining(["_index.md", "_map", "src", markerFile]));
    expect(await readFile(path.join(target, "_index.md"), "utf8")).toContain("- Exported: 2026-10-20T12:00:00.000Z");
    expect(await readFile(path.join(target, "src/lib/format.ts.md"), "utf8")).toContain("- Decisions: 0");
    expect(logs.join("\n")).toContain("start at");
  });

  it("replaces the previous export, dropping pages of deleted files", async () => {
    const project = path.join(directory, "project");
    await cp(fixture("topology"), project, { recursive: true });
    const { io } = fakeIo(directory);

    await expect(main(["export", "-C", project], directory, undefined, io)).resolves.toBe(0);
    expect(await readdir(path.join(project, ".laqueus/src"))).toContain("lone.ts.md");

    await rm(path.join(project, "src/lone.ts"));

    await expect(main(["export", "-C", project], directory, undefined, io)).resolves.toBe(0);
    expect(await readdir(path.join(project, ".laqueus/src"))).not.toContain("lone.ts.md");
  });

  it("refuses to replace a directory it did not write", async () => {
    const target = path.join(directory, "notes");
    await mkdir(target);
    await writeFile(path.join(target, "keep.md"), "mine\n");
    const { io, logs } = fakeIo(directory);

    await expect(main(["export", "-C", fixture("topology"), "-o", target], directory, undefined, io)).resolves.toBe(1);
    expect(await readdir(target)).toEqual(["keep.md"]);
    expect(logs.at(-1)).toContain("was not written by laqueus export");
  });

  it("leaves the CC breakdown out with --no-logic", async () => {
    const target = path.join(directory, "ctx");
    const { io } = fakeIo(directory);

    await expect(
      main(["export", "-C", fixture("topology"), "-o", target, "--no-logic"], directory, undefined, io),
    ).resolves.toBe(0);
    expect(await readFile(path.join(target, "src/a.ts.md"), "utf8")).toContain("- Decisions: not included");
  });

  it("prints its usage", async () => {
    const { io, stdout } = fakeIo(directory);

    await expect(main(["export", "--help"], directory, undefined, io)).resolves.toBe(0);
    expect(stdout()).toContain("Usage: laqueus export");
  });

  it("exports one part into its own directory", async () => {
    const project = path.join(directory, "project");
    await cp(fixture("sveltekit-sides"), project, { recursive: true });
    const { io } = fakeIo(directory);

    await expect(main(["export", "server", "-C", project], directory, undefined, io)).resolves.toBe(0);

    const target = path.join(project, ".laqueus-server");
    const start = await readFile(path.join(target, "_index.md"), "utf8");

    expect(start).toContain("- Scope: server");
    expect(await readdir(path.join(target, "src/lib/server"))).toEqual(expect.arrayContaining(["db.ts.md"]));
    expect(await readdir(path.join(target, "src/lib"))).not.toContain("format.ts.md");
    expect(await readdir(path.join(target, "_map"))).toEqual(["server"]);
  });

  it("refuses an unknown part before scanning logic", async () => {
    const { io, logs } = fakeIo(directory);

    await expect(main(["export", "nope", "-C", fixture("topology")], directory, undefined, io)).resolves.toBe(1);
    expect(logs.at(-1)).toContain('No part "nope"');
    expect(logs.at(-1)).toContain("laqueus list");
  });
});

const listed = async (args: readonly string[]) => {
  const { io, stdout, logs } = fakeIo(process.cwd());
  const code = await main(["list", ...args, "-C", fixture("sveltekit-sides")], process.cwd(), undefined, io);
  return { code, stdout: stdout(), logs };
};

describe("laqueus list", () => {
  it("starts with the sides, the viewer's hidden ones apart", async () => {
    const { code, stdout } = await listed([]);
    const result = JSON.parse(stdout);

    expect(code).toBe(0);
    expect(result.kind).toBe("project");
    expect(result.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ part: "client", label: "UI / client bundle", kind: "side" }),
        expect.objectContaining({ part: "server", label: "Server only", kind: "side" }),
      ]),
    );
    expect(result.parts.map((p: { part: string }) => p.part)).not.toContain("test");
    expect(result.hidden).toEqual(
      expect.arrayContaining([expect.objectContaining({ part: "test", kind: "side" })]),
    );
  });

  it("lists the areas inside a side", async () => {
    const { stdout, logs } = await listed(["server"]);
    const result = JSON.parse(stdout);

    expect(result.path).toEqual(["sveltekit-sides", "Server only"]);
    expect(result.parts).toEqual(
      expect.arrayContaining([expect.objectContaining({ part: "server/server-src" })]),
    );
    expect(logs.at(-1)).toContain("laqueus export <part>");
  });

  it("lists the files of a part with no sub-parts", async () => {
    const { stdout, logs } = await listed(["server/server-src"]);
    const result = JSON.parse(stdout);

    expect(result.files).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "src/lib/server/db.ts" })]),
    );
    expect(result).not.toHaveProperty("parts");
    expect(logs.at(-1)).toContain("laqueus export server/server-src");
  });

  it("names the valid parts when one does not exist", async () => {
    const { code, stdout, logs } = await listed(["server/nope"]);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(logs.at(-1)).toBe('No part "server/nope". Inside server: server/server-src, server/src-routes.');
  });
});
