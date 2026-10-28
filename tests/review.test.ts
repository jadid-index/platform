import { beforeAll, describe, expect, it } from "vitest";

import { approveSubmission, getPointsPreview, rejectSubmission } from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";
import { reviewErrorFromSql } from "@/lib/validation";

import {
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  rubricChoices,
  type RubricChoice,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

const local = testRun("rev");
let reviewer: TestUser;
let rows: RubricChoice[];

beforeAll(async () => {
  reviewer = await createTestReviewer(local("reviewer"), "Reviewer");
  ({ rows } = await rubricChoices());
});

const pending = (studentId: string, c: RubricChoice, date: string) =>
  insertPendingRow(studentId, { type_id: c.type_id, level: c.level, result: c.result, achievement_date: date });

async function statusOf(id: string) {
  const { data } = await getAdminClient().from("submissions").select("status").eq("id", id).single();
  return data!.status as string;
}

describe("approve / reject", () => {
  it("approves through approve_submission() with points from rubric_points", async () => {
    const student = await createTestStudent(local("a"), "A");
    const c = rows[0];
    const id = await pending(student.id, c, "2025-10-01");
    const res = await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result);
    expect(res).toEqual({ ok: true, rubric_points: c.points, points_awarded: Math.min(c.points, 100) });
    expect(await statusOf(id)).toBe("approved");
    // Only pending submissions can be decided.
    const again = await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result);
    expect(again.ok || reviewErrorFromSql(again.message).code).toBe("not_pending");
  });

  it("rejects only with a reason, and records it", async () => {
    const student = await createTestStudent(local("r"), "R");
    const id = await pending(student.id, rows[0], "2025-10-01");
    const empty = await rejectSubmission(id, reviewer.id, "   ");
    expect(empty.ok || reviewErrorFromSql(empty.message).code).toBe("reason_required");
    expect(await statusOf(id)).toBe("pending");

    expect(await rejectSubmission(id, reviewer.id, "TEST: ism mos emas")).toEqual({ ok: true });
    expect(await statusOf(id)).toBe("rejected");
    const { data } = await getAdminClient().from("reviews").select("decision, rejection_reason, points_awarded").eq("submission_id", id).single();
    expect(data).toEqual({ decision: "rejected", rejection_reason: "TEST: ism mos emas", points_awarded: null });
  });

  it("refuses an invalid type / level / result combination on approval", async () => {
    const student = await createTestStudent(local("c"), "C");
    const c = rows.find((r) => r.result === "confirmed")!;
    const id = await pending(student.id, c, "2025-10-01");
    const res = await approveSubmission(id, reviewer.id, c.type_id, c.level, "winner");
    expect(res.ok || reviewErrorFromSql(res.message).code).toBe("invalid_combination");
    expect(await statusOf(id)).toBe("pending");
  });

  it("refuses an achievement dated before 2023-09-01 even if it got into the table", async () => {
    const student = await createTestStudent(local("d"), "D");
    const id = await pending(student.id, rows[0], "2023-08-31");
    const res = await approveSubmission(id, reviewer.id, rows[0].type_id, rows[0].level, rows[0].result);
    expect(res.ok ? null : reviewErrorFromSql(res.message)).toEqual({ code: "date_too_early", date: "2023-09-01" });
  });

  it("refuses self-review and non-reviewers", async () => {
    const id = await pending(reviewer.id, rows[0], "2025-10-01");
    const self = await approveSubmission(id, reviewer.id, rows[0].type_id, rows[0].level, rows[0].result);
    expect(self.ok || reviewErrorFromSql(self.message).code).toBe("self_review");

    const student = await createTestStudent(local("e"), "E");
    const other = await createTestStudent(local("f"), "F");
    const sid = await pending(other.id, rows[0], "2025-10-01");
    const byStudent = await rejectSubmission(sid, student.id, "x");
    expect(byStudent.ok || reviewErrorFromSql(byStudent.message).code).toBe("forbidden");
  });
});

describe("yearly cap: getPointsPreview() matches approve_submission()", () => {
  it("below, at and above the cap, and in a different academic year", async () => {
    const student = await createTestStudent(local("cap"), "Cap");
    // The highest-point combination that does not divide the cap, so the last award before the cap is partial.
    const first = await pending(student.id, rows[0], "2024-11-01");
    const probe = (await getPointsPreview(first, rows[0].type_id, rows[0].level, rows[0].result))!;
    const cap = probe.cap;
    const c = [...rows].filter((r) => r.points < cap && cap % r.points !== 0).sort((a, b) => b.points - a.points)[0]
      ?? [...rows].filter((r) => r.points < cap).sort((a, b) => b.points - a.points)[0];
    const sameCategory = rows.filter((r) => r.category_code === c.category_code);
    expect(sameCategory.length).toBeGreaterThan(0);

    const steps: { used: number; preview: number; awarded: number }[] = [];
    async function approveOne(date: string) {
      const id = await pending(student.id, c, date);
      const preview = (await getPointsPreview(id, c.type_id, c.level, c.result))!;
      const res = await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result);
      if (!res.ok) throw new Error(res.message);
      expect(res.rubric_points).toBe(c.points);
      expect(preview.rubric_points).toBe(c.points);
      expect(preview.cap).toBe(cap);
      expect(preview.awarded).toBe(res.points_awarded);
      steps.push({ used: preview.used, preview: preview.awarded, awarded: res.points_awarded });
      return res.points_awarded;
    }

    // Below the cap: full points until the next award would cross it.
    let used = 0;
    while (used + c.points <= cap) {
      expect(await approveOne("2024-11-01")).toBe(c.points);
      used += c.points;
    }
    // Crossing the cap: only the remainder (zero when the points divide the cap).
    expect(await approveOne("2024-12-01")).toBe(cap - used);
    // At the cap: nothing more in this category and academic year (2024/25 runs to 31 August 2025).
    expect(await approveOne("2025-08-31")).toBe(0);
    expect(steps.at(-1)!.used).toBe(cap);
    // A different academic year has its own cap: 1 September 2025 starts 2025/26.
    expect(await approveOne("2025-09-01")).toBe(c.points);
  });
});
