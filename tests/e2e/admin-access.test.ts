import { beforeAll, describe, expect, it } from "vitest";

import { createTestAdmin, createTestReviewer, createTestStudent, type TestUser } from "../../scripts/lib/test-data";
import { testRun } from "../helpers";
import { sessionCookie } from "./session";

// Runs against a live app (next start), because the proxy only runs inside Next:
//   E2E_BASE_URL=http://localhost:3100 npm run test:e2e
const BASE = process.env.E2E_BASE_URL;
const local = testRun("e2eadm");

const PAGES = ["/admin", "/admin/users", "/admin/audit"];

describe.skipIf(!BASE)("admin access on the live app", () => {
  let student: TestUser;
  let reviewer: TestUser;
  let admin: TestUser;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    [student, reviewer, admin] = await Promise.all([
      createTestStudent(local("student"), "E2E Student", 2, { confirmed: true }),
      createTestReviewer(local("reviewer"), "E2E Reviewer"),
      createTestAdmin(local("admin"), "E2E Admin"),
    ]);
    cookies.student = await sessionCookie(student);
    cookies.reviewer = await sessionCookie(reviewer);
    cookies.admin = await sessionCookie(admin);
  });

  const get = (path: string, cookie?: string) =>
    fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  const patch = (cookie?: string) =>
    fetch(`${BASE}/api/admin/users/${crypto.randomUUID()}`, {
      method: "PATCH",
      redirect: "manual",
      headers: { "Content-Type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ role: "admin" }),
    });

  it("admin pages redirect visitors to /login and non-admins to /dashboard", async () => {
    for (const path of PAGES) {
      const anon = await get(path);
      expect(anon.status, `${path} anon`).toBe(307);
      expect(new URL(anon.headers.get("location")!, BASE).pathname).toBe("/login");
      for (const who of ["student", "reviewer"]) {
        const res = await get(path, cookies[who]);
        expect(res.status, `${path} ${who}`).toBe(307);
        expect(new URL(res.headers.get("location")!, BASE).pathname).toBe("/dashboard");
      }
    }
  });

  it("admin API refuses visitors (401) and non-admins (403), reads and writes", async () => {
    for (const path of ["/api/admin/users", "/api/admin/audit"]) {
      expect((await get(path)).status, `${path} anon`).toBe(401);
      expect((await get(path, cookies.student)).status, `${path} student`).toBe(403);
      expect((await get(path, cookies.reviewer)).status, `${path} reviewer`).toBe(403);
    }
    expect((await patch()).status).toBe(401);
    expect((await patch(cookies.student)).status).toBe(403);
    expect((await patch(cookies.reviewer)).status).toBe(403);
  });

  it("an admin gets the pages and the API", async () => {
    expect((await get("/admin/users", cookies.admin)).status).toBe(200);
    expect((await get("/admin/audit", cookies.admin)).status).toBe(200);
    const res = await get("/api/admin/users", cookies.admin);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect((await patch(cookies.admin)).status).toBe(404);
  });
});
