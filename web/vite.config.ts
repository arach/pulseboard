import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const workerOrigin = process.env.PULSE_WORKER_ORIGIN ?? "http://127.0.0.1:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    host: "127.0.0.1",
    proxy: { "/api": workerOrigin, "/auth": workerOrigin },
  },
  // The Worker serves ./public as static assets.
  build: { outDir: "../public", emptyOutDir: true },
});
