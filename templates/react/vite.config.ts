import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The React app only: the Worker (src/worker.ts) is built by Wrangler and serves dist/client.
export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist/client", emptyOutDir: true },
});
