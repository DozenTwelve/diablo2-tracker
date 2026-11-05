// The app's modules in Node, loaded through vite, for the check scripts and organize.mjs:
//   await withApp(async ({ load, parser }) => { const { x } = await load("/src/lib/x.js"); const wasm = await parser(); ... });
// The server is closed after, also when the body throws.
import { readFileSync } from "node:fs";
import { createServer } from "vite";

// Node can't fetch the .wasm by URL, so init the shared module instance with the bytes first
export const initParser = (wasm) => wasm.initSync({ module: readFileSync(new URL("../wasm/pkg/d2_parser_bg.wasm", import.meta.url)) });

export async function withApp(body) {
  // No dep scan: modules load for SSR, and a scan still running when the server closes prints a stack
  const vite = await createServer({ server: { middlewareMode: true, hmr: false }, appType: "custom", logLevel: "error", optimizeDeps: { noDiscovery: true } });
  try {
    const load = (path) => vite.ssrLoadModule(path);
    const parser = async () => {
      const wasm = await load("/wasm/pkg/d2_parser.js");
      initParser(wasm);
      return wasm;
    };
    await body({ load, parser });
  } finally {
    await vite.close();
  }
}
