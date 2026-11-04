import { readFileSync } from "node:fs";
import deckyPlugin from "@decky/rollup";

export default deckyPlugin({
  plugins: [
    // The save parser's WebAssembly, in the bundle as base64 (src/watch.js): nothing to fetch
    { name: "wasm-base64", load: (id) => (id.endsWith(".wasm") ? `export default ${JSON.stringify(readFileSync(id).toString("base64"))};` : null) },
  ],
  // parseSaves.js imports the parser lazily: one file, which is all Decky loads
  output: { inlineDynamicImports: true },
});
