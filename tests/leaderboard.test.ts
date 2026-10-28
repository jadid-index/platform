import { beforeAll, describe, expect, it } from "vitest";

import { approveSubmission, getLeaderboard, getPublicStudent } from "@/lib/db";

import {
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  rubricChoices,
  setProfileStatus,
  type RubricChoice,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

const local = testRun("lb");
// 2023/24 (the first counted year), so demo data in later years does not matter; only test rows are compared.
const YEAR = 2023;
const DATE = "2023-10-02";
let reviewer: TestUser;
let small: RubricChoice;
let other: RubricChoice;
const students: Record<"first" | "second" | "top" | "hidden", TestUser> = {} as never;

async function approve(student: TestUser, c: RubricChoice, title?: string) {
  const id = await insertPendingRow(student.id, { type_id: c.type_id, level: c.level, result: c.result, achievement_date: DATE, title });
  const res = await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result);
  if (!res.ok) throw new Error(res.message);
}

const testRows = async () => {
  const ids = new Set(Object.values(students).map((s) => s.id));
  return (await getLeaderboard({ year: YEAR })).rows.filter((r) => ids.has(r.student_id));
};

beforeAll(async () => {
  reviewer = await createTestReviewer(local("reviewer"), "Reviewer");
  const { rows } = await rubricChoices();
  // Two combinations in different categories, so no cap gets in the way.
  small = [...rows].sort((a, b) => a.points - b.points)[0];
  other = rows.find((r) => r.category_code !== small.category_code)!;
  for (const key of ["first", "second", "top", "hidden"] as const) {
    students[key] = await createTestStudent(local(key), `LB ${key}`);
  }
  // first and second tie on points; first was approved earlier. top has more points.
  await approve(students.first, small, "[TEST] Ochiq ish nomi");
  await approve(students.second, small);
  await approve(students.top, small);
  await approve(students.top, other);
  await approve(students.hidden, other);
});

describe("leaderboard", () => {
  it("ranks by points, ties broken by the earlier approval", async () => {
    const rows = await testRows();
    const order = rows.map((r) => r.student_id);
    expect(order.indexOf(students.top.id)).toBeLessThan(order.indexOf(students.first.id));
    expect(order.indexOf(students.first.id)).toBeLessThan(order.indexOf(students.second.id));
    const first = rows.find((r) => r.student_id === students.first.id)!;
    const second = rows.find((r) => r.student_id === students.second.id)!;
    expect(first.total_points).toBe(second.total_points);
    expect(first.rank).toBeLessThan(second.rank);
  });

  it("hides a profile whose status is not active", async () => {
    expect((await testRows()).some((r) => r.student_id === students.hidden.id)).toBe(true);
    await setProfileStatus(students.hidden.id, "rejected");
    expect((await testRows()).some((r) => r.student_id === students.hidden.id)).toBe(false);
    expect((await getLeaderboard({ year: "all" })).rows.some((r) => r.student_id === students.hidden.id)).toBe(false);
    expect(await getPublicStudent(students.hidden.id)).toBeNull();
  });

  it("returns only public fields (no email, file path or private profile columns)", async () => {
    const row = (await testRows())[0];
    expect(Object.keys(row).sort()).toEqual(
      ["approved_count", "faculty", "full_name", "photo_url", "rank", "student_id", "total_points", "university"].sort(),
    );
    const profile = (await getPublicStudent(students.first.id))!;
    expect(Object.keys(profile).sort()).toEqual(
      ["faculty", "full_name", "photo_url", "student_id", "total_points", "university", "works"].sort(),
    );
    expect(Object.keys(profile.works[0]).sort()).toEqual(
      ["achievement_date", "level", "points_awarded", "result", "title", "type_id", "type_name"].sort(),
    );
    const json = JSON.stringify(profile);
    // Keys only ("course" also appears in type names such as "Professional course certificate").
    expect(json).not.toMatch(/@example\.invalid|"file_path"|"file_sha256"|"course"|"telegram"|"bio"|"consent_\w+"|"email"/);
  });
});
