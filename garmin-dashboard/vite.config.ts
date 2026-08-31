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
      // shadcn-big-calendar's ESM build (HRA-143) re-exports
      // withDragAndDrop from this exact bare specifier — a directory import
      // with no "exports" map entry, which Vite's build/dev resolver
      // tolerates but Node's own ESM resolver (used by Vitest for
      // node_modules deps) rejects outright. We never use the DnD addon
      // (the calendar is read-only by design), so this just points the
      // broken specifier at its real entry file instead of pulling in a
      // patch tool for one unused re-export.
      "react-big-calendar/lib/addons/dragAndDrop": path.resolve(
        __dirname, "node_modules/react-big-calendar/lib/addons/dragAndDrop/index.js",
      ),
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
    // shadcn-big-calendar/react-big-calendar (HRA-143) are externalized by
    // Vitest's default SSR resolution, which uses Node's own ESM resolver
    // and ignores the resolve.alias above entirely — only deps actually run
    // through Vite's own pipeline see it. Forcing them inline routes them
    // through Vite instead, so the alias above (fixing a broken directory
    // import in shadcn-big-calendar's ESM build) actually takes effect.
    server: {
      deps: { inline: [/shadcn-big-calendar/, /react-big-calendar/] },
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://0.0.0.0:3001",
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
