import { afterAll } from "vitest";

import { cleanTestData } from "../scripts/lib/test-data";

// A unique email prefix per test file run, cleaned up afterwards (also after a failure).
export function testRun(name: string): (n: string | number) => string {
  const prefix = `${name}${Date.now().toString(36)}`;
  afterAll(async () => {
    await cleanTestData(prefix);
  });
  return (n) => `${prefix}-${n}`;
}
