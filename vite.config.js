import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: true,
    // The dev server runs on localhost; a LAN host is handy for a phone or a TouchDesigner machine.
    host: true,
    watch: {
      // Downloads landing in the project root (browser .crdownload locks) and
      // reference material must not take the dev server down.
      ignored: ["**/*.crdownload", "**/*.tmp", "**/reference/**", "**/public/splats/**", "**/touchdesigner/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./index.html", import.meta.url)),
        explore: fileURLToPath(new URL("./explore.html", import.meta.url)),
      },
    },
    target: "es2022",
    sourcemap: true,
  },
  // Spark ships a WASM-backed worker; keep it out of dependency pre-bundling.
  optimizeDeps: {
    exclude: ["@sparkjsdev/spark"],
  },
});
