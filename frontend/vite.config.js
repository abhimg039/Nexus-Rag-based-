import { fileURLToPath } from "node:url";

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The backend is proxied during development, so the frontend can call
// same-origin paths like `/api/documents`. That removes the hardcoded
// http://127.0.0.1:8000 base URL and sidesteps CORS entirely in dev.
//
// `loadEnv` is what reads .env files. Vite does not populate `process.env`
// from them, so reading process.env here only ever picked up a real shell
// variable and silently ignored VITE_BACKEND_ORIGIN in .env.
//
// The directory is resolved from this file rather than from process.cwd(), so
// the value is read from frontend/.env (see .env.example there) no matter which
// directory vite was launched from. Anchoring it here also keeps the backend's
// root .env — which holds database credentials — out of this process entirely.
const frontendDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, frontendDir, "");
  const backend = env.VITE_BACKEND_ORIGIN || "http://127.0.0.1:8000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: backend, changeOrigin: true },
        "/health": { target: backend, changeOrigin: true },
      },
    },
    build: {
      target: "es2022",
      sourcemap: false,
      // No manual vendor chunking on purpose. Vite 8 bundles with Rolldown,
      // whose chunking options differ from Rollup's and are still moving
      // (`manualChunks` object form is unsupported, `advancedChunks` is already
      // deprecated). This app is small and served from localhost, so splitting
      // React into its own chunk buys nothing worth coupling the config to a
      // bundler-internal API for.
    },
  };
});
