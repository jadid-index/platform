import { defineConfig } from "vitest/config";

import base from "./vitest.config";

// HTTP tests against a running app: E2E_BASE_URL=http://localhost:3000 npm run test:e2e
// (mergeConfig would concatenate the include lists, so the test block is replaced instead).
export default defineConfig({
  ...base,
  test: { ...base.test, include: ["tests/e2e/**/*.test.ts"], exclude: [] },
});
