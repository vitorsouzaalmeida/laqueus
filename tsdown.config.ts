import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts"],
  format: "esm",
  platform: "node",
  target: "node26",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  fixedExtension: false,
});
