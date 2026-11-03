import { beforeAll, describe, expect, it } from "vitest";

import {
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  rubricChoices,
  type RubricChoice,
  type TestUser,
} from "../../scripts/lib/test-data";
import { testRun } from "../helpers";
import { sessionCookie } from "./session";

// Runs against a live app (next start), because the leaderboard cache only exists inside Next:
//   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
const BASE = process.env.E2E_BASE_URL;
const local = testRun("e2e");
const YEAR = 2023;

// The public row's tier code ("" for approved work without a tier), or null when the student is not listed.
async function boardHas(studentId: string): Promise<string | null> {
  const res = await fetch(`${BASE}/api/leaderboard?academic_year=${YEAR}&limit=200`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: { student_id: string; tier: { code: string } | null }[] };
  const row = body.rows.find((r) => r.student_id === studentId);
  return row ? (row.tier?.code ?? "") : null;
}

describe.skipIf(!BASE)("live app", () => {
  let reviewer: TestUser;
  let student: TestUser;
  let choice: RubricChoice;

  beforeAll(async () => {
    reviewer = await createTestReviewer(local("reviewer"), "E2E Reviewer");
    student = await createTestStudent(local("student"), "E2E Student");
    choice = (await rubricChoices()).rows[0];
  });

  it("/api/health reports ok without details", async () => {
    const res = await fetch(`${BASE}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("a new approval shows on /api/leaderboard immediately", async () => {
    const id = await insertPendingRow(student.id, {
      type_id: choice.type_id,
      level: choice.level,
      result: choice.result,
      achievement_date: "2023-10-05",
    });
    // Warm the cache for this view while the student is not on it yet.
    expect(await boardHas(student.id)).toBeNull();
    expect(await boardHas(student.id)).toBeNull();

    const cookie = await sessionCookie(reviewer);
    const res = await fetch(`${BASE}/api/review/submissions/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", cookie },
      body: JSON.stringify({ type_id: choice.type_id, level: choice.level, result: choice.result }),
    });
    expect(res.status).toBe(200);

    const started = Date.now();
    let seen = await boardHas(student.id);
    while (seen === null && Date.now() - started < 45_000) {
      await new Promise((r) => setTimeout(r, 2000));
      seen = await boardHas(student.id);
    }
    console.log(`PROBE appeared after ${Date.now() - started} ms:`, seen);
    expect(seen).not.toBeNull();
  });

  it("public JSON carries no points, rank or approval-order data", async () => {
    const forbidden = /"[a-z_]*(points?|rank|score|approved_at|reviewed_at|last_approved)[a-z_]*"\s*:/i;
    for (const path of [
      "/api/leaderboard",
      "/api/leaderboard?academic_year=all",
      `/api/leaderboard?academic_year=${YEAR}&limit=200`,
      `/api/leaderboard/${student.id}`,
    ]) {
      const res = await fetch(`${BASE}${path}`);
      const text = await res.text();
      expect(text, path).not.toMatch(forbidden);
    }
  });

  it("the list view shows the same students in one list, without points", async () => {
    // Runs after the approval test, so the probe student is on the 2023 board.
    const page = async (qs: string) => {
      const res = await fetch(`${BASE}/leaderboard?${qs}`);
      expect(res.status).toBe(200);
      return res.text();
    };
    const tiers = await page(`year=${YEAR}`);
    const list = await page(`year=${YEAR}&view=list`);
    for (const html of [tiers, list]) expect(html).toContain(`/students/${student.id}`);
    expect(tiers).toMatch(/id="tier-[^"]+"/);
    expect(list).not.toMatch(/id="tier-[^"]+"/);
    // The only "ball" text allowed is the yearly maximum in the explanation line.
    expect(list.replaceAll("400 ball", "")).not.toMatch(/\d+\s*ball/);
    // The switch keeps the other filters; "show more" keeps the view.
    expect(await page(`year=all&view=list&limit=1`)).not.toContain("view=tiers");
  });

  it("review routes refuse a student session and no session", async () => {
    const id = crypto.randomUUID();
    const body = JSON.stringify({ reason: "x" });
    const anon = await fetch(`${BASE}/api/review/submissions/${id}/reject`, { method: "POST", body });
    expect(anon.status).toBe(401);
    const cookie = await sessionCookie(await createTestStudentWithPassword());
    const asStudent = await fetch(`${BASE}/api/review/submissions/${id}/reject`, { method: "POST", body, headers: { cookie } });
    expect(asStudent.status).toBe(403);
  });
});

// Test students are created unconfirmed; password sign-in works because "Confirm email" is off (rule 6).
async function createTestStudentWithPassword(): Promise<TestUser> {
  return createTestStudent(local("student2"), "E2E Student 2", 2, { confirmed: true });
}
