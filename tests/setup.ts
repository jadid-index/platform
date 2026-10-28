import { existsSync } from "node:fs";

import { vi } from "vitest";

for (const file of [".env.test.local", ".env.local"]) {
  if (existsSync(file)) {
    process.loadEnvFile(file);
    break;
  }
}
if (process.env.NODE_ENV === "production") throw new Error("Refusing to run tests with NODE_ENV=production");

// "use cache" only works inside Next; outside it the cache helpers become no-ops and every call hits the database.
vi.mock("next/cache", () => ({ cacheTag: () => {}, cacheLife: () => {}, revalidateTag: () => {} }));
