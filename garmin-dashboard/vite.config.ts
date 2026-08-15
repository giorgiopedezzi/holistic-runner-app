/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  // Vitest (T4/HRA-62). jsdom for React component tests; the setup file
  // registers @testing-library/jest-dom matchers. Reuses this file's `@/`
  // alias + the react plugin, so tests resolve imports exactly like the app.
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        // The AI workout classifier holds the connection open ~15-25s (local Ollama,
        // stream:false, no bytes until the end). On the dev proxy's pooled/keep-alive
        // connection to :3001 that long request was reset mid-flight (ECONNRESET →
        // 502 in the browser) — even though the same request DIRECT to :3001 (a fresh,
        // non-keep-alive connection, like curl) completes fine. Root cause: HTTP
        // keep-alive connection reuse, not a timeout (see HRA-43).
        // Fix: force a fresh connection per proxied request (Connection: close),
        // mirroring the direct call that works. Verified: classify via proxy now 200.
        // The generous timeouts are belt-and-suspenders for any long request.
        timeout: 300_000,
        proxyTimeout: 300_000,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => { proxyReq.setHeader("connection", "close"); });
        },
      },
    },
  },
});
