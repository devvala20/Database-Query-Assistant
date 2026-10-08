import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": "/src",
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      input: {
        index: "index.html",
        taskpane: "taskpane.html",
        commands: "commands.html",
      },
    },
  },
  server: {
    port: 3000,
    // Vercel handles HTTPS in deployment; locally use --https flag or a proxy
    headers: {
      // Required for SharedArrayBuffer (DuckDB-WASM)
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  optimizeDeps: {
    exclude: [
      // DuckDB-WASM bundles its own worker; exclude to prevent Vite from pre-bundling
      "@duckdb/duckdb-wasm",
    ],
  },
});
