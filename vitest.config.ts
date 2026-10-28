import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Integration tests against the Supabase project in .env.local (or .env.test.local if present).
// They create test-...@example.invalid users and remove them afterwards. Files run one at a time.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
