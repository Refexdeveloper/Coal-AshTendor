import path from "path";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  /** The API server (server/) runs on its own port; in development /api is proxied to it. */
  const api = env.API_PROXY_TARGET || (env.VITE_API_PORT ? `http://localhost:${env.VITE_API_PORT}` : "http://localhost:4000");
  return {
    plugins: [react()],
    // The production build goes inside the server, which serves it on its own port (4000).
    build: {
      outDir: path.resolve(__dirname, "../server/public"),
      emptyOutDir: true,
    },
    resolve: {
      alias: { "@client": path.resolve(__dirname, "src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
        "/auth/refexone": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      },
    },
    preview: {
      port: 5173,
      proxy: {
        "/api": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
        "/auth/refexone": { target: api, changeOrigin: true, timeout: 0, proxyTimeout: 0 },
      },
    },
  };
});
