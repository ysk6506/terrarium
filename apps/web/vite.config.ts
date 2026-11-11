import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const core = fileURLToPath(new URL("../../packages/core/src/", import.meta.url));
const PURE_MODULES = /[\\/](packages[\\/]core[\\/]src|apps[\\/]web[\\/]src[\\/](logic|moss))[\\/]/;
const SELF_REGISTERING = /[\\/]tools[\\/]shell-layers\.ts$/;
const server = process.env.TERRARIUM_SERVER ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@terrarium\/core\/(.*)$/, replacement: `${core}$1/index.ts` }],
  },
  server: {
    port: 5173,
    proxy: { "/api": server, "/r/": server, "/mcp/": server, "/healthz": server },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      // The core packages and the web's logic and moss modules are pure: nothing runs when they are imported (the one
      // exception is the fake shell's layer commands, which register themselves). Saying so lets the build leave out
      // what the first screen never uses, instead of keeping every module that has one used export (ADR-0141).
      treeshake: { moduleSideEffects: (id) => !PURE_MODULES.test(id) || SELF_REGISTERING.test(id) },
    },
  },
});
