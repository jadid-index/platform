import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  approveSubmission,
  deleteTier,
  getDefaultLeaderboard,
  getLeaderboard,
  getOwnStanding,
  getPublicStudent,
  getTierFor,
  getTopTierStudents,
  listTiers,
  saveAchievementType,
  saveTier,
  setRubricPoints,
} from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";
import type { Tier } from "@/lib/types";

import {
  createTestAdmin,
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  setProfileStatus,
  testCategoryCode,
  testTypeName,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

// Route handlers are called directly with a faked session (none here: the public view).
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

const local = testRun("tier");
const prefix = local("").slice(0, -1);
const CAT = testCategoryCode(prefix);
const REASON = "TEST: tier test";

let admin: TestUser;
let reviewer: TestUser;
let student: TestUser; // approved work in two academic years
let hidden: TestUser;
let typeId: number;

// A test type in a test category (cap 400), so the points land exactly where the test wants them.
async function award(s: TestUser, points: number, date: string) {
  const res = await setRubricPoints(admin.id, [{ type_id: typeId, level: "national", result: "confirmed", points }], REASON);
  if (!res.ok) throw new Error(res.message);
  const id = await insertPendingRow(s.id, { type_id: typeId, level: "national", result: "confirmed", achievement_date: date });
  const approved = await approveSubmission(id, reviewer.id, typeId, "national", "confirmed");
  if (!approved.ok) throw new Error(approved.message);
}

beforeAll(async () => {
  const { error } = await getAdminClient().from("categories").insert({ code: CAT, name: "TEST tiers", yearly_cap: 400 });
  if (error) throw error;
  [admin, reviewer, student, hidden] = await Promise.all([
    createTestAdmin(local("admin"), "Tier Admin"),
    createTestReviewer(local("reviewer"), "Tier Reviewer"),
    createTestStudent(local("student"), "Tier Student"),
    createTestStudent(local("hidden"), "Tier Hidden"),
  ]);
  const type = await saveAchievementType(admin.id, null, {
    name: { uz: testTypeName(prefix, "tier") },
    category_code: CAT,
    base_points: 1,
    has_placement: false,
    proof_hint: null,
    certificate_ref_required: false,
    reason: REASON,
  });
  if (!type.ok) throw new Error(type.message);
  typeId = type.data.id;
  // 2023/24: 200 points; 2024/25: 70 points. All-time uses the best year (200), not the sum (270).
  await award(student, 200, "2023-10-05");
  await award(student, 70, "2024-10-05");
  await award(hidden, 250, "2023-10-06");
});

// ------------------------------------------------------------------ tiers

const SEED: [string, number][] = [
  ["S+", 360],
  ["S", 300],
  ["A+", 240],
  ["A", 180],
  ["B", 120],
  ["C", 60],
  ["D", 1],
];

describe("tier_for()", () => {
  it("every boundary: min_points gets the tier, one point less gets the tier below (0 points: no tier)", async () => {
    const tiers = (await listTiers()).filter((x) => x.min_points < 99000).sort((a, b) => b.min_points - a.min_points);
    expect(tiers.length).toBeGreaterThan(0);
    for (const [i, tier] of tiers.entries()) {
      expect((await getTierFor(tier.min_points))?.code, `${tier.min_points}`).toBe(tier.code);
      expect((await getTierFor(tier.min_points - 1))?.code ?? null, `${tier.min_points - 1}`).toBe(tiers[i + 1]?.code ?? null);
    }
    expect(await getTierFor(0)).toBeNull();
  });

  it("the seeded placeholders: 359/360, 299/300, 239/240, 179/180, 119/120, 59/60, 0/1", async (ctx) => {
    const tiers = (await listTiers()).filter((x) => x.min_points < 99000);
    const seeded = JSON.stringify(SEED) === JSON.stringify(tiers.map((x) => [x.code, x.min_points]));
    if (!seeded) {
      console.warn("SKIPPED seed boundary check: the tiers were edited on /admin/rubric (the generic check above still runs).");
      ctx.skip();
    }
    const cases: [number, string | null][] = [
      [400, "S+"], [360, "S+"], [359, "S"], [300, "S"], [299, "A+"], [240, "A+"], [239, "A"],
      [180, "A"], [179, "B"], [120, "B"], [119, "C"], [60, "C"], [59, "D"], [1, "D"], [0, null],
    ];
    for (const [points, code] of cases) expect((await getTierFor(points))?.code ?? null, `${points}`).toBe(code);
  });

  it("a year view uses that year's points; all-time uses the best academic year", async () => {
    const row = async (year: number | "all") => (await getLeaderboard({ year })).rows.find((r) => r.student_id === student.id);
    expect((await row(2023))?.tier?.code).toBe((await getTierFor(200))?.code);
    expect((await row(2024))?.tier?.code).toBe((await getTierFor(70))?.code);
    expect((await row("all"))?.tier?.code).toBe((await getTierFor(200))?.code);
    // The owner sees the exact points behind it.
    expect(await getOwnStanding(student.id, 2024)).toMatchObject({ academic_year: 2024, points: 70 });
    expect(await getOwnStanding(student.id, "all")).toMatchObject({ academic_year: 2023, points: 200 });
  });
});

// ------------------------------------------------------- nothing private leaks

// Keys that would reveal exact points, ranks or the order of approvals.
const FORBIDDEN_KEY = /(^|_)(points?|rank|ranking|score|place)($|_)|approved_at|reviewed_at|last_approved|^rubric/i;

function forbiddenKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [
      ...(FORBIDDEN_KEY.test(k) ? [`${path}.${k}`] : []),
      ...forbiddenKeys(v, `${path}.${k}`),
    ]);
  }
  return [];
}

// /api/meta is reference data for the forms (the rubric itself, with its points per combination), not student
// data, so it is the one public route allowed to carry "points".
const NOT_STUDENT_DATA = new Set(["meta/route.ts"]);

const API = join(process.cwd(), "src/app/api");
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

describe("public responses", () => {
  it("no public route returns points, rank or approval-order data (every GET that answers without a session)", async () => {
    session.userId = null;
    const files = (readdirSync(API, { recursive: true }) as string[]).filter((f) => f.endsWith("route.ts"));
    const scanned: string[] = [];
    for (const file of files) {
      const rel = relative(API, join(API, file));
      const mod = (await import(join(API, file))) as Record<string, unknown>;
      if (typeof mod.GET !== "function") continue;
      // Dynamic segments get the test student's id, so a profile route answers with real data.
      const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], student.id]));
      const queries = rel === "leaderboard/route.ts" ? ["", "?academic_year=all", "?academic_year=2023", "?academic_year=2024&limit=200"] : [""];
      for (const q of queries) {
        const res = await (mod.GET as Handler)(new Request(`http://test.local/api/x${q}`), { params: Promise.resolve(params) });
        if (res.status !== 200) continue; // not public (401 / 403), or nothing to show
        scanned.push(`${rel}${q}`);
        if (NOT_STUDENT_DATA.has(rel)) continue;
        expect(forbiddenKeys(await res.json()), `${rel}${q}`).toEqual([]);
      }
    }
    // The scan must actually have reached the public student data.
    expect(scanned).toEqual(expect.arrayContaining(["leaderboard/route.ts", "leaderboard/[studentId]/route.ts", "health/route.ts"]));
  });

  it("the data behind the public pages has no points either (leaderboard, profile, landing card)", async () => {
    const values = await Promise.all([
      getLeaderboard({ year: 2023 }),
      getLeaderboard({ year: "all" }),
      getDefaultLeaderboard({}),
      getPublicStudent(student.id),
      getTopTierStudents(5),
    ]);
    for (const v of values) expect(forbiddenKeys(v)).toEqual([]);
  });

  it("the profile route shows tiers and works with level and result only", async () => {
    const { GET } = await import("@/app/api/leaderboard/[studentId]/route");
    const res = await GET(new Request("http://test.local"), { params: Promise.resolve({ studentId: student.id }) });
    const body = (await res.json()) as {
      tier: { code: string } | null;
      current_year: { tier: unknown };
      works: Record<string, unknown>[];
    };
    expect(body.tier?.code).toBe((await getTierFor(200))?.code);
    expect(Object.keys(body.works[0]).sort()).toEqual(["achievement_date", "level", "result", "title", "type_id", "type_name"].sort());
  });

  it("a hidden profile does not appear in any public view", async () => {
    const onBoard = async () =>
      (await Promise.all([getLeaderboard({ year: 2023 }), getLeaderboard({ year: "all" })])).map((b) =>
        b.rows.some((r) => r.student_id === hidden.id),
      );
    expect(await onBoard()).toEqual([true, true]);
    await setProfileStatus(hidden.id, "hidden");
    expect(await onBoard()).toEqual([false, false]);
    expect(await getPublicStudent(hidden.id)).toBeNull();
    const { GET } = await import("@/app/api/leaderboard/[studentId]/route");
    expect((await GET(new Request("http://test.local"), { params: Promise.resolve({ studentId: hidden.id }) })).status).toBe(404);
    const list = await (await import("@/app/api/leaderboard/route")).GET(
      new Request("http://test.local/api/leaderboard?academic_year=2023&limit=200"),
    );
    expect(JSON.stringify(await list.json())).not.toContain(hidden.id);
  });

  it("orders by tier, then by name; the landing card shows only the best non-empty tier", async () => {
    const board = await getLeaderboard({ year: 2023 });
    const sort = (t: { sort_order: number } | null) => t?.sort_order ?? Infinity;
    const collator = new Intl.Collator("uz", { sensitivity: "base" });
    for (let i = 1; i < board.rows.length; i++) {
      const [a, b] = [board.rows[i - 1], board.rows[i]];
      expect(sort(a.tier) < sort(b.tier) || (sort(a.tier) === sort(b.tier) && collator.compare(a.full_name, b.full_name) <= 0)).toBe(true);
    }
    const top = await getTopTierStudents(5);
    if (top.tier) for (const r of top.rows) expect(r.tier?.code).toBe(top.tier.code);
  });
});

// --------------------------------------------------------------- tier editor

describe("tier editor", () => {
  // Test tiers sit far above any real score (min 99000+), so nobody's tier changes while they exist.
  const body = (code: string, min: number, reason = REASON) => ({ code, label: { uz: `TEST ${code}` }, min_points: min, reason });

  it("validates codes, thresholds and the reason, writes the audit row, and renumbers sort_order", async () => {
    const created = await saveTier(admin.id, null, body("ZZ1", 99001));
    expect(created).toMatchObject({ ok: true, data: { code: "ZZ1", sort_order: 1 } });
    try {
      expect(await saveTier(admin.id, null, body("S+", 99002))).toMatchObject({ ok: false, code: "tier_code_taken" });
      expect(await saveTier(admin.id, null, body("ZZ2", 99001))).toMatchObject({ ok: false, code: "tier_min_taken" });
      expect(await saveTier(admin.id, null, body("bad code", 99003))).toMatchObject({ ok: false, code: "invalid_tier_code" });
      expect(await saveTier(admin.id, null, body("ZZ3", 0))).toMatchObject({ ok: false, code: "points_out_of_range" });
      expect(await saveTier(admin.id, null, body("ZZ4", 99004, "x"))).toMatchObject({ ok: false, code: "reason_required" });
      expect(await saveTier(reviewer.id, "ZZ1", body("ZZ1", 99005))).toMatchObject({ ok: false, code: "forbidden" });

      // sort_order always follows min_points: the test tier is first, and the real tiers keep their order.
      const tiers: Tier[] = await listTiers();
      const byMin = [...tiers].sort((a, b) => b.min_points - a.min_points).map((x) => x.code);
      expect(tiers.map((x) => x.code)).toEqual(byMin);

      const { data: audit } = await getAdminClient()
        .from("audit_log")
        .select("action, entity, entity_id, details")
        .eq("actor_id", admin.id)
        .eq("entity", "tier")
        .eq("entity_id", "ZZ1");
      expect(audit).toHaveLength(1);
      expect(audit![0]).toMatchObject({ action: "tier.created", details: { old: null, new: { min_points: 99001 }, reason: REASON } });
    } finally {
      expect(await deleteTier(admin.id, "ZZ1", REASON)).toMatchObject({ ok: true });
    }
    expect((await listTiers()).map((x) => x.sort_order)).toEqual((await listTiers()).map((_, i) => i + 1));
  });

  it("the tier routes refuse visitors and non-admins", async () => {
    const { POST } = await import("@/app/api/admin/tiers/route");
    const { PATCH, DELETE } = await import("@/app/api/admin/tiers/[code]/route");
    const call = async (who: string | null) => {
      session.userId = who;
      const req = () => new Request("http://test.local", { method: "POST", body: JSON.stringify(body("ZZ9", 99009)) });
      const ctx = { params: Promise.resolve({ code: "S%2B" }) };
      return [(await POST(req())).status, (await PATCH(req(), ctx)).status, (await DELETE(req(), ctx)).status];
    };
    expect(await call(null)).toEqual([401, 401, 401]);
    expect(await call(reviewer.id)).toEqual([403, 403, 403]);
    expect(await call(student.id)).toEqual([403, 403, 403]);
    expect((await listTiers()).some((x) => x.code === "ZZ9")).toBe(false);
  });
});
