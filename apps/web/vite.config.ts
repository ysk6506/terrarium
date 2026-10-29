import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const core = fileURLToPath(new URL("../../packages/core/src/", import.meta.url));
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
  },
});
