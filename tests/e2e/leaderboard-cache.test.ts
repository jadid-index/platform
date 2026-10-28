import { createServerClient } from "@supabase/ssr";
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

// Runs against a live app (next start), because the leaderboard cache only exists inside Next:
//   E2E_BASE_URL=http://localhost:3000 npm run test:e2e
const BASE = process.env.E2E_BASE_URL;
const local = testRun("e2e");
const YEAR = 2023;

// Signs in with the publishable key, as the browser would, and returns the auth cookies @supabase/ssr sets.
async function sessionCookie(user: TestUser): Promise<string> {
  const jar = new Map<string, string>();
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => cookies.forEach(({ name, value }) => (value ? jar.set(name, value) : jar.delete(name))),
    },
  });
  const { error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password });
  if (error) throw error;
  return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function boardHas(studentId: string): Promise<number | null> {
  const res = await fetch(`${BASE}/api/leaderboard?academic_year=${YEAR}&limit=200`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { rows: { student_id: string; total_points: number }[] };
  return body.rows.find((r) => r.student_id === studentId)?.total_points ?? null;
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
    const approved = (await res.json()) as { points_awarded: number };

    const started = Date.now();
    let seen = await boardHas(student.id);
    while (seen === null && Date.now() - started < 45_000) {
      await new Promise((r) => setTimeout(r, 2000));
      seen = await boardHas(student.id);
    }
    console.log(`PROBE appeared after ${Date.now() - started} ms:`, seen);
    expect(seen).toBe(approved.points_awarded);
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
