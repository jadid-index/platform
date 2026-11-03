import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { approveSubmission, getLeaderboard, listUsersForAdmin, setUserRole, setUserStatus } from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";

import {
  createTestAdmin,
  createTestReviewer,
  createTestStaff,
  createTestStudent,
  insertPendingRow,
  isTestEmail,
  rubricChoices,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

// Route handlers are called directly. The session is faked at the lowest layer (getClaims), so the real
// requireAdmin() and the real profile lookup still decide.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

const local = testRun("adm");
let admin: TestUser;
let reviewer: TestUser;
let student: TestUser;
let employer: TestUser;

beforeAll(async () => {
  [admin, reviewer, student, employer] = await Promise.all([
    createTestAdmin(local("admin"), "Admin"),
    createTestReviewer(local("reviewer"), "Reviewer"),
    createTestStudent(local("student"), "Student"),
    createTestStaff(local("employer"), "Employer", "employer"),
  ]);
});

// ------------------------------------------------------------ route discovery

const API_ADMIN = join(process.cwd(), "src/app/api/admin");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

// Every route.ts under src/app/api/admin, so a new admin route is covered without editing this test.
function adminRouteFiles(): string[] {
  return (readdirSync(API_ADMIN, { recursive: true }) as string[])
    .filter((f) => f.endsWith("route.ts"))
    .map((f) => join(API_ADMIN, f));
}

async function adminHandlers(): Promise<{ name: string; method: string; handler: Handler; params: Record<string, string> }[]> {
  const out = [];
  for (const file of adminRouteFiles()) {
    const mod = (await import(file)) as Record<string, unknown>;
    const rel = relative(API_ADMIN, file);
    const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], crypto.randomUUID()]));
    for (const method of METHODS) {
      if (typeof mod[method] === "function") out.push({ name: `${method} ${rel}`, method, handler: mod[method] as Handler, params });
    }
  }
  return out;
}

function call(h: { method: string; handler: Handler; params: Record<string, string> }, body?: unknown) {
  const req = new Request("http://test.local/api/admin/x", {
    method: h.method,
    headers: { "Content-Type": "application/json" },
    body: h.method === "GET" ? undefined : JSON.stringify(body ?? { status: "active" }),
  });
  return h.handler(req, { params: Promise.resolve(h.params) });
}

describe("admin route access", () => {
  it("finds the admin routes", async () => {
    const names = (await adminHandlers()).map((h) => h.name).sort();
    expect(names).toEqual(
      expect.arrayContaining([
        "GET audit/route.ts",
        "GET users/route.ts",
        "PATCH users/[id]/route.ts",
        "GET rubric/route.ts",
        "POST rubric/types/route.ts",
        "PATCH rubric/types/[id]/route.ts",
        "DELETE rubric/types/[id]/route.ts",
        "PUT rubric/points/route.ts",
        "PATCH rubric/categories/[code]/route.ts",
      ]),
    );
  });

  it("refuses every admin route without a session (401) and for student, reviewer and employer (403)", async () => {
    const handlers = await adminHandlers();
    for (const h of handlers) {
      session.userId = null;
      expect((await call(h)).status, `${h.name} anon`).toBe(401);
      for (const [who, user] of [["student", student], ["reviewer", reviewer], ["employer", employer]] as const) {
        session.userId = user.id;
        expect((await call(h)).status, `${h.name} ${who}`).toBe(403);
      }
    }
  });

  it("a non-admin PATCH changes nothing and writes no audit row", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    session.userId = reviewer.id;
    const res = await PATCH(
      new Request("http://test.local", { method: "PATCH", body: JSON.stringify({ role: "admin" }) }),
      { params: Promise.resolve({ id: reviewer.id }) },
    );
    expect(res.status).toBe(403);
    expect(await roleOf(reviewer.id)).toBe("reviewer");
    expect(await auditRows(reviewer.id)).toHaveLength(0);
  });

  it("lets an active admin read the lists, and not once the admin is hidden", async () => {
    const { GET: users } = await import("@/app/api/admin/users/route");
    const { GET: audit } = await import("@/app/api/admin/audit/route");
    const temp = await createTestAdmin(local("admin-temp"), "Admin Temp");
    session.userId = temp.id;
    const res = await users(new Request(`http://test.local/api/admin/users?q=${encodeURIComponent(local("student"))}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: { id: string; email: string }[]; total: number };
    expect(body.rows.map((r) => r.id)).toEqual([student.id]);
    expect(body.rows[0].email).toBe(student.email);
    expect((await audit(new Request("http://test.local/api/admin/audit"))).status).toBe(200);

    expect(await setUserStatus(admin.id, temp.id, "hidden")).toMatchObject({ ok: true, changed: true });
    expect((await users(new Request("http://test.local/api/admin/users"))).status).toBe(403);
  });

  it("validates the PATCH body (one change, known values only)", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    session.userId = admin.id;
    for (const body of [{}, { role: "superuser" }, { status: "rejected" }, { role: "admin", status: "active" }]) {
      const res = await PATCH(new Request("http://test.local", { method: "PATCH", body: JSON.stringify(body) }), {
        params: Promise.resolve({ id: student.id }),
      });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
  });
});

// ------------------------------------------------------------- SQL rules

async function roleOf(id: string) {
  const { data } = await getAdminClient().from("profiles").select("role").eq("id", id).single();
  return data!.role as string;
}

async function auditRows(targetId: string) {
  const { data, error } = await getAdminClient()
    .from("audit_log")
    .select("actor_id, action, entity, entity_id, details, created_at")
    .eq("entity", "profile")
    .eq("entity_id", targetId)
    .order("id");
  if (error) throw error;
  return data;
}

describe("role and status changes", () => {
  it("a role change writes one audit row with who, what, old, new and time; no-op changes write none", async () => {
    const target = await createTestStaff(local("promote"), "Promote", "reviewer");
    const before = Date.now();
    expect(await setUserRole(admin.id, target.id, "employer")).toEqual({ ok: true, old: "reviewer", new: "employer", changed: true });
    expect(await setUserRole(admin.id, target.id, "employer")).toEqual({ ok: true, old: "employer", new: "employer", changed: false });

    const rows = await auditRows(target.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor_id: admin.id,
      action: "profile.role_changed",
      entity: "profile",
      entity_id: target.id,
      details: { old: "reviewer", new: "employer" },
    });
    expect(new Date(rows[0].created_at).getTime()).toBeGreaterThan(before - 60_000);
    expect(await roleOf(target.id)).toBe("employer");
  });

  it("the PATCH route changes the role and status through the same functions", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const target = await createTestStaff(local("patch"), "Patch", "reviewer");
    session.userId = admin.id;
    const patch = (body: unknown) =>
      PATCH(new Request("http://test.local", { method: "PATCH", body: JSON.stringify(body) }), {
        params: Promise.resolve({ id: target.id }),
      });
    const res = await patch({ status: "hidden" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ old: "active", new: "hidden", changed: true });
    expect((await auditRows(target.id)).map((r) => r.action)).toEqual(["profile.status_changed"]);
    expect((await patch({ role: "admin" })).status).toBe(200);
  });

  it("only an active admin can change anything, also when calling SQL directly", async () => {
    const res = await setUserRole(reviewer.id, reviewer.id, "admin");
    expect(res).toMatchObject({ ok: false, code: "forbidden" });
    expect(await roleOf(reviewer.id)).toBe("reviewer");
    expect(await setUserRole(admin.id, crypto.randomUUID(), "reviewer")).toMatchObject({ ok: false, code: "not_found" });
  });

  it("the admin SQL functions cannot be called with the publishable key", async () => {
    const anon = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
    const write = await anon.rpc("admin_set_role", { p_actor: admin.id, p_target: student.id, p_role: "admin" });
    expect(write.error).not.toBeNull();
    const read = await anon.rpc("admin_list_users", {});
    expect(read.error).not.toBeNull();
    expect(await roleOf(student.id)).toBe("student");
  });

  it("a student row still needs university, faculty, course and consent", async () => {
    const res = await setUserRole(admin.id, employer.id, "student");
    expect(res).toMatchObject({ ok: false, code: "student_fields_missing" });
    expect(await roleOf(employer.id)).toBe("employer");
    // A student moved to another role and back keeps their fields, so this works.
    const s = await createTestStudent(local("roundtrip"), "Roundtrip");
    expect(await setUserRole(admin.id, s.id, "employer")).toMatchObject({ ok: true, changed: true });
    expect(await setUserRole(admin.id, s.id, "student")).toMatchObject({ ok: true, changed: true });
  });

  it("hidden removes a student from public views and active brings them back", async () => {
    const s = await createTestStudent(local("hide"), "Hide");
    const c = (await rubricChoices()).rows[0];
    const id = await insertPendingRow(s.id, { type_id: c.type_id, level: c.level, result: c.result, achievement_date: "2025-10-01" });
    expect((await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result)).ok).toBe(true);
    const onBoard = async () => (await getLeaderboard({ year: "all" })).rows.some((r) => r.student_id === s.id);

    expect(await onBoard()).toBe(true);
    expect(await setUserStatus(admin.id, s.id, "hidden")).toMatchObject({ ok: true, old: "active", new: "hidden" });
    expect(await onBoard()).toBe(false);
    expect(await setUserStatus(admin.id, s.id, "active")).toMatchObject({ ok: true, new: "active" });
    expect(await onBoard()).toBe(true);
  });
});

describe("last admin", () => {
  // The zero-admins case can only be reached when every active admin in the project is a test admin.
  async function realActiveAdmins(): Promise<number> {
    const { rows } = await listUsersForAdmin({ role: "admin", status: "active", limit: 200, offset: 0 });
    return rows.filter((r) => !isTestEmail(r.email)).length;
  }

  it("an admin can step down while another active admin exists", async () => {
    const a = await createTestAdmin(local("step-a"), "Step A");
    const b = await createTestAdmin(local("step-b"), "Step B");
    expect(await setUserRole(a.id, a.id, "reviewer")).toMatchObject({ ok: true, changed: true });
    expect(await setUserStatus(b.id, b.id, "hidden")).toMatchObject({ ok: true, changed: true });
  });

  it("the last active admin cannot remove their own admin role or hide themselves", async (ctx) => {
    const real = await realActiveAdmins();
    if (real > 0) {
      console.warn(`SKIPPED last-admin check: the project has ${real} real active admin(s); use a test project (.env.test.local).`);
      ctx.skip();
    }
    // Leave exactly one active test admin: hide every other active (test) admin first.
    const last = await createTestAdmin(local("last"), "Last");
    const { rows } = await listUsersForAdmin({ role: "admin", status: "active", limit: 200, offset: 0 });
    for (const r of rows) if (r.id !== last.id) expect((await setUserStatus(last.id, r.id, "hidden")).ok).toBe(true);

    expect(await setUserRole(last.id, last.id, "reviewer")).toMatchObject({ ok: false, code: "last_admin" });
    expect(await setUserStatus(last.id, last.id, "hidden")).toMatchObject({ ok: false, code: "last_admin" });
    expect(await roleOf(last.id)).toBe("admin");
  });
});
