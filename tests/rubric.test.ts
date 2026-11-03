import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  approveSubmission,
  deleteAchievementType,
  getLeaderboard,
  getMeta,
  saveAchievementType,
  setAchievementTypeActive,
  setCategoryCap,
  setRubricPoints,
} from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";
import type { TypeBody } from "@/lib/validation";

import {
  createTestAdmin,
  createTestReviewer,
  createTestStudent,
  fields,
  insertPendingRow,
  samplePdf,
  submitThroughApiPath,
  testCategoryCode,
  testTypeName,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

// The route handlers are called directly with a faked session (see tests/admin.test.ts).
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

// Everything here runs on a test category and [TEST] types, never on the real rubric. cleanTestData removes them.
const local = testRun("rub");
const prefix = local("").slice(0, -1);
const CAT = testCategoryCode(prefix);
const CAT_SMALL = `${CAT}small`;
const REASON = "TEST: rubric test";

let admin: TestUser;
let reviewer: TestUser;
let student: TestUser;

beforeAll(async () => {
  const { error } = await getAdminClient()
    .from("categories")
    .insert([
      { code: CAT, name: "TEST category", yearly_cap: 100 },
      { code: CAT_SMALL, name: "TEST small category", yearly_cap: 5 },
    ]);
  if (error) throw error;
  [admin, reviewer, student] = await Promise.all([
    createTestAdmin(local("admin"), "Rubric Admin"),
    createTestReviewer(local("reviewer"), "Rubric Reviewer"),
    createTestStudent(local("student"), "Rubric Student"),
  ]);
});

function typeBody(label: string, over: Partial<TypeBody> = {}): TypeBody {
  return {
    name: { uz: testTypeName(prefix, label) },
    category_code: CAT,
    base_points: 10,
    has_placement: false,
    proof_hint: null,
    certificate_ref_required: false,
    reason: REASON,
    ...over,
  };
}

async function newType(label: string, cells: { level: "university" | "national" | "international"; points: number }[] = []) {
  const created = await saveAchievementType(admin.id, null, typeBody(label));
  if (!created.ok) throw new Error(`create type failed: ${created.message}`);
  if (cells.length) {
    const res = await setRubricPoints(
      admin.id,
      cells.map((c) => ({ type_id: created.data.id, level: c.level, result: "confirmed" as const, points: c.points })),
      REASON,
    );
    if (!res.ok) throw new Error(`set points failed: ${res.message}`);
  }
  return created.data;
}

async function reviewOf(submissionId: string) {
  const { data, error } = await getAdminClient()
    .from("reviews")
    .select("rubric_points, points_awarded, category_code")
    .eq("submission_id", submissionId)
    .single();
  if (error) throw error;
  return data;
}

const boardTotal = async (studentId: string) =>
  (await getLeaderboard({ year: "all" })).rows.find((r) => r.student_id === studentId)?.total_points ?? null;

async function auditCount(): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", admin.id);
  if (error) throw error;
  return count ?? 0;
}

describe("approved points are snapshots", () => {
  it("editing points and the cap changes neither existing reviews nor the leaderboard; the next approval uses the new rubric", async () => {
    const s = await createTestStudent(local("snap"), "Snapshot");
    const type = await newType("snapshot", [{ level: "national", points: 10 }]);
    const first = await insertPendingRow(s.id, { type_id: type.id, level: "national", result: "confirmed", achievement_date: "2025-10-01" });
    expect(await approveSubmission(first, reviewer.id, type.id, "national", "confirmed")).toMatchObject({ ok: true, points_awarded: 10 });
    expect(await boardTotal(s.id)).toBe(10);

    // A pending submission is evaluated with the rubric at approval time, not at submission time.
    const second = await insertPendingRow(s.id, { type_id: type.id, level: "national", result: "confirmed", achievement_date: "2025-10-02" });

    expect(await setRubricPoints(admin.id, [{ type_id: type.id, level: "national", result: "confirmed", points: 40 }], REASON)).toMatchObject({ ok: true, data: 1 });
    expect(await setCategoryCap(admin.id, CAT, 45, REASON)).toMatchObject({ ok: true });

    expect(await reviewOf(first)).toEqual({ rubric_points: 10, points_awarded: 10, category_code: CAT });
    expect(await boardTotal(s.id)).toBe(10);

    // New rubric (40) and new cap (45): 10 already used, so 35 are awarded.
    expect(await approveSubmission(second, reviewer.id, type.id, "national", "confirmed")).toMatchObject({
      ok: true,
      rubric_points: 40,
      points_awarded: 35,
    });
    expect(await reviewOf(first)).toEqual({ rubric_points: 10, points_awarded: 10, category_code: CAT });
    expect(await boardTotal(s.id)).toBe(45);

    expect(await setCategoryCap(admin.id, CAT, 100, REASON)).toMatchObject({ ok: true });
  });
});

describe("validation", () => {
  it("rejects invalid values and writes no audit row for them", async () => {
    const type = await newType("invalid", [{ level: "national", points: 20 }]);
    const cell = (over: Record<string, unknown>) => ({ type_id: type.id, level: "national", result: "confirmed", points: 5, ...over });
    const before = await auditCount();

    const cases: [Promise<{ ok: boolean; code?: string }>, string][] = [
      [setRubricPoints(admin.id, [cell({ points: -1 })] as never, REASON), "points_out_of_range"],
      [setRubricPoints(admin.id, [cell({ points: 101 })] as never, REASON), "points_out_of_range"],
      [setRubricPoints(admin.id, [cell({ points: 2.5 })] as never, REASON), "points_out_of_range"],
      [setRubricPoints(admin.id, [cell({ result: "winner" })] as never, REASON), "result_mismatch"],
      [setRubricPoints(admin.id, [cell({ level: "galactic" })] as never, REASON), "invalid_cell"],
      [setRubricPoints(admin.id, [cell({}), cell({ points: 6 })] as never, REASON), "duplicate_cell"],
      [setRubricPoints(admin.id, [cell({})] as never, ""), "reason_required"],
      [setRubricPoints(admin.id, [cell({})] as never, "  ab "), "reason_required"],
      [setCategoryCap(admin.id, CAT, 0, REASON), "cap_out_of_range"],
      [setCategoryCap(admin.id, CAT, 1001, REASON), "cap_out_of_range"],
      [setCategoryCap(admin.id, CAT, 15, REASON), "cap_below_points"],
      [setCategoryCap(admin.id, "no_such_category", 50, REASON), "not_found"],
      [saveAchievementType(admin.id, null, typeBody("too many points", { base_points: 101 })), "points_out_of_range"],
      [saveAchievementType(admin.id, null, typeBody("no name", { name: { uz: " " } })), "name_required"],
      [saveAchievementType(admin.id, null, typeBody("invalid")), "name_taken"],
      // Moving the type to a category whose cap (5) is below its cells (20).
      [saveAchievementType(admin.id, type.id, typeBody("invalid", { category_code: CAT_SMALL, base_points: 1 })), "cap_below_points"],
    ];
    for (const [promise, code] of cases) expect(await promise, code).toMatchObject({ ok: false, code });

    // All or nothing: a valid cell next to an invalid one is not saved either.
    const mixed = await setRubricPoints(
      admin.id,
      [cell({ points: 7 }), cell({ level: "international", points: 999 })] as never,
      REASON,
    );
    expect(mixed).toMatchObject({ ok: false, code: "points_out_of_range" });
    const { data } = await getAdminClient().from("rubric_points").select("points").eq("type_id", type.id).eq("level", "national").single();
    expect(data!.points).toBe(20);
    expect(await auditCount()).toBe(before);
  });

  it("the API refuses a body that is not valid before it reaches SQL", async () => {
    const { PUT } = await import("@/app/api/admin/rubric/points/route");
    const { PATCH } = await import("@/app/api/admin/rubric/categories/[code]/route");
    session.userId = admin.id;
    const put = (body: unknown) => PUT(new Request("http://test.local", { method: "PUT", body: JSON.stringify(body) }));
    const ok = { type_id: 1, level: "national", result: "confirmed", points: 5 };
    for (const body of [
      { cells: [{ ...ok, points: "5" }], reason: REASON },
      { cells: [{ ...ok, points: 1.5 }], reason: REASON },
      { cells: [], reason: REASON },
      { cells: [ok] },
      { cells: [ok], reason: "x" },
    ]) {
      expect((await put(body)).status, JSON.stringify(body)).toBe(400);
    }
    const res = await PATCH(new Request("http://test.local", { method: "PATCH", body: JSON.stringify({ yearly_cap: -3, reason: REASON }) }), {
      params: Promise.resolve({ code: CAT }),
    });
    expect(res.status).toBe(400);
  });

  it("a valid change writes one audit row with old, new and the reason; unchanged cells write nothing", async () => {
    const type = await newType("audit");
    const before = await auditCount();
    const cells = [{ type_id: type.id, level: "university" as const, result: "confirmed" as const, points: 7 }];
    expect(await setRubricPoints(admin.id, cells, "  TEST: new cell  ")).toMatchObject({ ok: true, data: 1 });
    expect(await setRubricPoints(admin.id, cells, REASON)).toMatchObject({ ok: true, data: 0 });
    expect(await auditCount()).toBe(before + 1);

    const { data } = await getAdminClient()
      .from("audit_log")
      .select("action, entity, entity_id, details")
      .eq("entity", "rubric_points")
      .eq("entity_id", `${type.id}:university:confirmed`)
      .single();
    expect(data).toEqual({
      action: "rubric.points_changed",
      entity: "rubric_points",
      entity_id: `${type.id}:university:confirmed`,
      details: { old: null, new: 7, reason: "TEST: new cell" },
    });
  });

  it("protects types and cells that submissions use", async () => {
    const type = await newType("used", [{ level: "national", points: 8 }]);
    await insertPendingRow(student.id, { type_id: type.id, level: "national", result: "confirmed", achievement_date: "2025-10-01" });

    expect(await deleteAchievementType(admin.id, type.id, REASON)).toMatchObject({ ok: false, code: "type_has_submissions" });
    expect(await saveAchievementType(admin.id, type.id, typeBody("used", { has_placement: true }))).toMatchObject({
      ok: false,
      code: "type_has_submissions",
    });
    expect(
      await setRubricPoints(admin.id, [{ type_id: type.id, level: "national", result: "confirmed", points: null }], REASON),
    ).toMatchObject({ ok: false, code: "cell_in_use" });
    // Deactivating is the way out for a used type.
    expect(await setAchievementTypeActive(admin.id, type.id, false, REASON)).toMatchObject({ ok: true, data: { active: false } });
  });

  it("an unused type can switch has_placement (its old cells go) and can be deleted", async () => {
    const type = await newType("unused", [{ level: "university", points: 4 }]);
    expect(await saveAchievementType(admin.id, type.id, typeBody("unused", { has_placement: true }))).toMatchObject({
      ok: true,
      data: { has_placement: true },
    });
    const { count } = await getAdminClient().from("rubric_points").select("id", { count: "exact", head: true }).eq("type_id", type.id);
    expect(count).toBe(0);
    expect(await deleteAchievementType(admin.id, type.id, REASON)).toMatchObject({ ok: true });
    const { data } = await getAdminClient().from("achievement_types").select("id").eq("id", type.id).maybeSingle();
    expect(data).toBeNull();
  });
});

describe("only admins edit the rubric", () => {
  it("the SQL functions refuse a reviewer, and the API refuses a reviewer session", async () => {
    const type = await newType("guarded", [{ level: "national", points: 9 }]);
    const cells = [{ type_id: type.id, level: "national" as const, result: "confirmed" as const, points: 1 }];
    expect(await setRubricPoints(reviewer.id, cells, REASON)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await setCategoryCap(reviewer.id, CAT, 50, REASON)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await saveAchievementType(reviewer.id, null, typeBody("by reviewer"))).toMatchObject({ ok: false, code: "forbidden" });
    expect(await setAchievementTypeActive(reviewer.id, type.id, false, REASON)).toMatchObject({ ok: false, code: "forbidden" });
    expect(await deleteAchievementType(reviewer.id, type.id, REASON)).toMatchObject({ ok: false, code: "forbidden" });

    const { PUT } = await import("@/app/api/admin/rubric/points/route");
    session.userId = reviewer.id;
    const res = await PUT(new Request("http://test.local", { method: "PUT", body: JSON.stringify({ cells, reason: REASON }) }));
    expect(res.status).toBe(403);

    const { data } = await getAdminClient().from("rubric_points").select("points").eq("type_id", type.id).single();
    expect(data!.points).toBe(9);
  });
});

describe("inactive types", () => {
  it("are hidden from the student form and cannot be submitted", async () => {
    const type = await newType("inactive", [{ level: "national", points: 6 }]);
    expect(await setAchievementTypeActive(admin.id, type.id, false, REASON)).toMatchObject({ ok: true });

    const form = await getMeta();
    expect(form.achievement_types.some((x) => x.id === type.id)).toBe(false);
    expect(form.rubric_points.some((x) => x.type_id === type.id)).toBe(false);
    const review = await getMeta({ includeInactive: true });
    expect(review.achievement_types.find((x) => x.id === type.id)).toMatchObject({ active: false });

    const { created } = await submitThroughApiPath(
      student.id,
      fields({ type_id: type.id, level: "national", achievement_date: "2025-10-01" }),
      { bytes: samplePdf(`${prefix} inactive`), name: "proof.pdf", contentType: "application/pdf" },
    );
    expect(created).toMatchObject({ ok: false, code: "type_inactive" });

    // The trigger blocks it even when the server check is skipped.
    await expect(
      insertPendingRow(student.id, { type_id: type.id, level: "national", result: "confirmed", achievement_date: "2025-10-01" }),
    ).rejects.toMatchObject({ message: "achievement type is not active" });
  });

  it("the draft journal types from the migration exist, inactive, with the certificate reference required", async () => {
    const { data, error } = await getAdminClient()
      .from("achievement_types")
      .select("id, active, certificate_ref_required, category_code")
      .in("id", [13, 14, 15, 16])
      .order("id");
    if (error) throw error;
    expect(data).toHaveLength(4);
    for (const row of data!) expect(row).toMatchObject({ active: false, certificate_ref_required: true, category_code: "scientific" });
  });
});
