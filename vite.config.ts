import { fileURLToPath } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL("./viewer", import.meta.url)),
  base: "./",
  plugins: [svelte()],
  build: {
    outDir: "../dist/viewer",
    emptyOutDir: true,
  },
});
