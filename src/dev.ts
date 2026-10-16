import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { main } from "./cli";

const vite = await createServer({
  configFile: false,
  root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../viewer"),
  server: { middlewareMode: true },
  appType: "spa",
});
// pnpm runs scripts from the package directory; INIT_CWD is where the user invoked it.
const code = await main(process.argv.slice(2), process.env.INIT_CWD ?? process.cwd(), vite.middlewares);
await vite.close();
process.exit(code);
