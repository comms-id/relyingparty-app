import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The Workers runtime module, outside a Worker: a stand-in base class for the tests.
    alias: { "cloudflare:workers": resolve(import.meta.dirname, "test/cloudflare-workers.ts") },
  },
  test: { environment: "node", include: ["test/**/*.test.ts"] },
});
