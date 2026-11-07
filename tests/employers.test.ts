import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EMPLOYER_TERMS_VERSION } from "@/lib/consent";
import { approveSubmission, listTalent, setOpenToWork } from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";

import {
  createTestAdmin,
  createTestAuthUser,
  createTestEmployer,
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  rubricChoices,
  setProfileStatus,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

// Route handlers are called directly. The session is faked at the lowest layer (getClaims), so the real
// requireEmployer() / requireActiveStudent() / requireTalentViewer() and the real profile lookup decide.
// user_metadata is faked too, to show that a role there is ignored.
const session = vi.hoisted(() => ({ userId: null as string | null, meta: {} as Record<string, unknown> }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId
          ? { data: { claims: { sub: session.userId, user_metadata: session.meta } }, error: null }
          : { data: null, error: null },
    },
  }),
}));

const local = testRun("emp");
const db = () => getAdminClient();

let admin: TestUser;
let reviewer: TestUser;
let employer: TestUser; // unverified
let verified: TestUser;
let open: TestUser; // open to work, one approved work
let closed: TestUser; // not open to work
let hidden: TestUser; // open to work, then hidden
let category: string;

beforeAll(async () => {
  [admin, reviewer, employer, verified, open, closed, hidden] = await Promise.all([
    createTestAdmin(local("admin"), "Emp Admin"),
    createTestReviewer(local("reviewer"), "Emp Reviewer"),
    createTestEmployer(local("employer"), "Emp Employer", false),
    createTestEmployer(local("verified"), "Emp Verified", true),
    createTestStudent(local("open"), "Emp Open"),
    createTestStudent(local("closed"), "Emp Closed"),
    createTestStudent(local("hidden"), "Emp Hidden"),
  ]);
  for (const s of [open, hidden]) expect(await setOpenToWork(s.id, true)).toEqual({ ok: true, data: true });

  const c = (await rubricChoices()).rows[0];
  category = c.category_code;
  const id = await insertPendingRow(open.id, { type_id: c.type_id, level: c.level, result: c.result, achievement_date: "2025-10-01" });
  expect((await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result)).ok).toBe(true);
  await setProfileStatus(hidden.id, "hidden");
});

afterEach(() => {
  session.userId = null;
  session.meta = {};
  delete process.env.CONTACT_REQUESTS_DAILY_CAP;
});

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

function req(method: string, body?: unknown, url = "http://test.local/api/x") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const as = (user: TestUser | null, meta: Record<string, unknown> = {}) => {
  session.userId = user?.id ?? null;
  session.meta = meta;
};

async function profileRow(id: string) {
  const { data } = await db().from("profiles").select("role, status").eq("id", id).maybeSingle();
  return data;
}

// ------------------------------------------------------------ self-assigned roles

describe("role self-assignment (CLAUDE.md rule 10)", () => {
  const employerBody = (extra: Record<string, unknown> = {}) => ({
    role: "employer",
    company_name: "TEST Co",
    contact_person: "TEST Person",
    contact: "+998 90 123 45 67",
    terms_version: EMPLOYER_TERMS_VERSION,
    ...extra,
  });

  it("refuses reviewer, admin and unknown roles, and privileged keys, without creating a profile", async () => {
    const { POST } = await import("@/app/api/profile/route");
    const user = await createTestAuthUser(local("selfrole"));
    as(user, { role: "admin" });
    const bodies = [
      employerBody({ role: "reviewer" }),
      employerBody({ role: "admin" }),
      employerBody({ role: "superuser" }),
      employerBody({ verified: true }),
      employerBody({ status: "active" }),
      employerBody({ work_email: "test@example.invalid" }), // dropped in 20261107000001
      employerBody({ role: ["employer", "admin"] }),
      { ...employerBody(), role: undefined },
    ];
    for (const body of bodies) {
      const res = await POST(req("POST", body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(await profileRow(user.id)).toBeNull();
  });

  it("creates an unverified employer from the body; a role in user metadata is ignored", async () => {
    const { POST } = await import("@/app/api/profile/route");
    const user = await createTestAuthUser(local("selfemp"));
    as(user, { role: "admin", signup_as: "admin" });
    const res = await POST(req("POST", employerBody({ company_name: "TEST Emp Co", contact_person: "TEST Emp Person" })));
    expect(res.status).toBe(201);
    expect(await profileRow(user.id)).toEqual({ role: "employer", status: "active" });
    const { data } = await db().from("employer_profiles").select("verified, company_name").eq("profile_id", user.id).single();
    expect(data).toEqual({ verified: false, company_name: "TEST Emp Co" });
    // A second attempt (for example as a student) cannot change the role.
    expect((await POST(req("POST", employerBody()))).status).toBe(409);
  });

  it("an employer cannot verify itself; an admin can, with one audit row", async () => {
    const { PATCH } = await import("@/app/api/admin/users/[id]/route");
    const ctx = { params: Promise.resolve({ id: employer.id }) };
    as(employer);
    expect((await PATCH(req("PATCH", { employer_verified: true }), ctx)).status).toBe(403);

    as(admin);
    const res = await PATCH(req("PATCH", { employer_verified: true }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ old: false, new: true, changed: true });
    const { data: rows } = await db()
      .from("audit_log")
      .select("actor_id, details")
      .eq("action", "employer.verified_changed")
      .eq("entity_id", employer.id);
    expect(rows).toEqual([{ actor_id: admin.id, details: { old: false, new: true } }]);
    expect((await PATCH(req("PATCH", { employer_verified: false }), ctx)).status).toBe(200);
    // Not an employer: refused.
    expect((await PATCH(req("PATCH", { employer_verified: true }), { params: Promise.resolve({ id: open.id }) })).status).toBe(409);
  });
});

// ------------------------------------------------------------ route separation

const API = join(process.cwd(), "src/app/api");
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

async function handlersUnder(...dirs: string[]) {
  const out: { name: string; method: string; handler: Handler; params: Record<string, string> }[] = [];
  for (const dir of dirs) {
    const root = join(API, dir);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith("route.ts"));
    for (const f of files) {
      const file = join(root, f);
      const mod = (await import(file)) as Record<string, unknown>;
      const rel = relative(API, file);
      const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], crypto.randomUUID()]));
      for (const method of METHODS) {
        if (typeof mod[method] === "function") out.push({ name: `${method} ${rel}`, method, handler: mod[method] as Handler, params });
      }
    }
  }
  return out;
}

const callHandler = (h: { method: string; handler: Handler; params: Record<string, string> }) =>
  h.handler(req(h.method, h.method === "GET" ? undefined : {}), { params: Promise.resolve(h.params) });

describe("route separation (CLAUDE.md rule 10)", () => {
  it("employer routes: 401 signed out, 403 for students and reviewers", async () => {
    const handlers = await handlersUnder("talent");
    expect(handlers.map((h) => h.name).sort()).toEqual(
      ["GET talent/route.ts", "GET talent/[studentId]/route.ts", "GET talent/requests/route.ts", "POST talent/requests/route.ts"].sort(),
    );
    for (const h of handlers) {
      as(null);
      expect((await callHandler(h)).status, `${h.name} anon`).toBe(401);
      for (const [who, user] of [["student", open], ["reviewer", reviewer]] as const) {
        as(user);
        expect((await callHandler(h)).status, `${h.name} ${who}`).toBe(403);
      }
    }
  });

  it("admins may read the directory but not send or list requests", async () => {
    const handlers = await handlersUnder("talent");
    as(admin);
    for (const h of handlers) {
      const status = (await callHandler(h)).status;
      if (h.name.includes("requests")) expect(status, h.name).toBe(403);
      else expect(status, h.name).not.toBe(403);
    }
  });

  it("student and reviewer routes refuse employers (403)", async () => {
    const handlers = await handlersUnder("submissions", "extract", "me/contact-requests", "me/open-to-work", "review");
    expect(handlers.length).toBeGreaterThan(8);
    as(employer);
    for (const h of handlers) expect((await callHandler(h)).status, h.name).toBe(403);
  });
});

// ------------------------------------------------------------ directory

const CONTACT_KEY = /(^|_)(points?|rank|ranking|score|email|phone|telegram|contact|course)($|_)|approved_at/i;
function leakedKeys(value: unknown, path = "$"): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => leakedKeys(v, `${path}[${i}]`));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => [...(CONTACT_KEY.test(k) ? [`${path}.${k}`] : []), ...leakedKeys(v, `${path}.${k}`)]);
  }
  return [];
}

async function allTalentIds(query: Record<string, string> = {}): Promise<string[]> {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const list = await listTalent({ page, faculty_id: undefined, tier: undefined, category: undefined, ...query } as never);
    ids.push(...list.rows.map((r) => r.student_id));
    if (page * list.page_size >= list.total) break;
  }
  return ids;
}

describe("talent directory", () => {
  it("lists only active students who are open to work", async () => {
    const ids = await allTalentIds();
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(closed.id);
    expect(ids).not.toContain(hidden.id);
    expect(ids).not.toContain(employer.id);
  });

  it("filters by category and tier", async () => {
    expect(await allTalentIds({ category } as never)).toContain(open.id);
    const other = (await rubricChoices()).rows.find((r) => r.category_code !== category)!.category_code;
    expect(await allTalentIds({ category: other } as never)).not.toContain(open.id);
    expect(await allTalentIds({ tier: "NOPE" } as never)).not.toContain(open.id);
  });

  it("returns no points, rank or contact details, and a hidden or closed student is a 404", async () => {
    const { GET: list } = await import("@/app/api/talent/route");
    const { GET: one } = await import("@/app/api/talent/[studentId]/route");
    as(employer);
    const res = await list(req("GET", undefined, "http://test.local/api/talent"));
    expect(res.status).toBe(200);
    expect(leakedKeys(await res.json())).toEqual([]);

    const detail = await one(req("GET"), { params: Promise.resolve({ studentId: open.id }) });
    expect(detail.status).toBe(200);
    const body = await detail.json();
    expect(body.works).toHaveLength(1);
    expect(leakedKeys(body)).toEqual([]);
    for (const s of [closed, hidden]) {
      expect((await one(req("GET"), { params: Promise.resolve({ studentId: s.id }) })).status).toBe(404);
    }
  });

  it("logs each employer view of a student profile in audit_log", async () => {
    const { GET: one } = await import("@/app/api/talent/[studentId]/route");
    const count = async () =>
      (
        await db()
          .from("audit_log")
          .select("id", { count: "exact", head: true })
          .eq("action", "employer.profile_viewed")
          .eq("actor_id", verified.id)
          .eq("entity_id", open.id)
      ).count ?? 0;
    const before = await count();
    as(verified);
    await one(req("GET"), { params: Promise.resolve({ studentId: open.id }) });
    await one(req("GET"), { params: Promise.resolve({ studentId: open.id }) });
    expect(await count()).toBe(before + 2);
    // Admin views are not employer views.
    as(admin);
    await one(req("GET"), { params: Promise.resolve({ studentId: open.id }) });
    expect(await count()).toBe(before + 2);
  });
});

// ------------------------------------------------------------ contact requests

async function send(from: TestUser, to: TestUser, message = "TEST: we have an internship") {
  const { POST } = await import("@/app/api/talent/requests/route");
  as(from);
  return POST(req("POST", { student_id: to.id, message }));
}

async function respond(student: TestUser, id: string, body: unknown) {
  const { PATCH } = await import("@/app/api/me/contact-requests/[id]/route");
  as(student);
  return PATCH(req("PATCH", body), { params: Promise.resolve({ id }) });
}

async function sentList(from: TestUser) {
  const { GET } = await import("@/app/api/talent/requests/route");
  as(from);
  return (await (await GET()).json()) as { rows: { id: string; student_id: string; status: string; shared_contact: unknown }[] };
}

// Requests created "today" by an employer, to reach its daily limit without many students.
async function fillRequests(from: TestUser, to: TestUser, n: number) {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const rows = Array.from({ length: n }, () => ({
    employer_id: from.id,
    student_id: to.id,
    message: "TEST filler",
    status: "declined",
    responded_at: old,
  }));
  const { error } = await db().from("contact_requests").insert(rows);
  if (error) throw error;
}

describe("contact requests", () => {
  it("blocks a duplicate pending request and validates the message", async () => {
    const s = await createTestStudent(local("dup"), "Emp Dup");
    await setOpenToWork(s.id, true);
    const e = await createTestEmployer(local("dupemp"), "Emp Dup Employer", false);
    expect((await send(e, s)).status).toBe(201);
    const dup = await send(e, s);
    expect(dup.status).toBe(409);
    expect(await dup.json()).toEqual({ error: "duplicate_pending" });
    expect((await send(e, s, "x".repeat(501))).status).toBe(400);
    expect((await send(e, closed)).status).toBe(404);
    expect((await send(e, hidden)).status).toBe(404);
  });

  it("shares no contact detail before acceptance, and only the chosen one after", async () => {
    const s = await createTestStudent(local("acc"), "Emp Accept");
    await setOpenToWork(s.id, true);
    const e = await createTestEmployer(local("accemp"), "Emp Accept Employer", false);
    const other = await createTestEmployer(local("accother"), "Emp Other Employer", false);
    const { id } = (await (await send(e, s)).json()) as { id: string };

    const before = (await sentList(e)).rows.find((r) => r.id === id)!;
    expect(before).toMatchObject({ status: "pending", shared_contact: null });
    const { GET: one } = await import("@/app/api/talent/[studentId]/route");
    as(e);
    const detail = await (await one(req("GET"), { params: Promise.resolve({ studentId: s.id }) })).json();
    expect(detail.request).toMatchObject({ status: "pending", shared_contact: null });
    expect(JSON.stringify(detail)).not.toContain(s.email);

    // The student sees who asks, not the employer's contact.
    const { GET: inbox } = await import("@/app/api/me/contact-requests/route");
    as(s);
    const received = await (await inbox()).json();
    expect(received.pending).toBe(1);
    expect(received.rows[0]).not.toHaveProperty("contact");
    expect(received.rows[0].company_name).toContain("TEST");

    expect((await respond(s, id, { action: "accept", kind: "telegram", value: "nope" })).status).toBe(400);
    expect((await respond(s, id, { action: "accept", kind: "telegram", value: "@test_student" })).status).toBe(200);
    expect((await respond(s, id, { action: "decline" })).status).toBe(409);

    const after = (await sentList(e)).rows.find((r) => r.id === id)!;
    expect(after).toMatchObject({ status: "accepted", shared_contact: { kind: "telegram", value: "@test_student" } });
    expect((await sentList(other)).rows.some((r) => r.student_id === s.id)).toBe(false);
    expect((await send(e, s)).status).toBe(409); // already accepted

    // Hiding the profile (the kill switch) hides the contact again.
    await setProfileStatus(s.id, "hidden");
    expect((await sentList(e)).rows.find((r) => r.id === id)!.shared_contact).toBeNull();

    // The audit row never holds the value.
    const { data: audit } = await db().from("audit_log").select("details").eq("action", "contact_request.accepted").eq("actor_id", s.id);
    expect(JSON.stringify(audit)).not.toContain("@test_student");
  });

  it("a student cannot answer someone else's request", async () => {
    const s = await createTestStudent(local("own"), "Emp Own");
    await setOpenToWork(s.id, true);
    const e = await createTestEmployer(local("ownemp"), "Emp Own Employer", false);
    const { id } = (await (await send(e, s)).json()) as { id: string };
    expect((await respond(closed, id, { action: "decline" })).status).toBe(404);
  });

  it("declined requests cannot be re-sent for 30 days", async () => {
    const s = await createTestStudent(local("dec"), "Emp Decline");
    await setOpenToWork(s.id, true);
    const e = await createTestEmployer(local("decemp"), "Emp Decline Employer", false);
    const { id } = (await (await send(e, s)).json()) as { id: string };
    expect((await respond(s, id, { action: "decline" })).status).toBe(200);
    const again = await send(e, s);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "declined_cooldown" });

    await db().from("contact_requests").update({ responded_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", id);
    expect((await send(e, s)).status).toBe(201);
  });

  it("limits unverified employers to 10 and verified to 30 new requests a day", async () => {
    const [a, b] = [await createTestStudent(local("rla"), "Emp Rate A"), await createTestStudent(local("rlb"), "Emp Rate B")];
    for (const s of [a, b]) await setOpenToWork(s.id, true);

    const unverified = await createTestEmployer(local("rlu"), "Emp Rate Unverified", false);
    await fillRequests(unverified, a, 10);
    const limited = await send(unverified, b);
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ error: "rate_limited" });

    const ver = await createTestEmployer(local("rlv"), "Emp Rate Verified", true);
    await fillRequests(ver, a, 29);
    expect((await send(ver, b)).status).toBe(201); // the 30th
    await db().from("contact_requests").update({ status: "declined", responded_at: new Date(Date.now() - 40 * 86_400_000).toISOString() }).eq("employer_id", ver.id).eq("status", "pending");
    expect((await send(ver, b)).status).toBe(429); // the 31st
  });

  it("stops every employer at the global daily cap", async () => {
    const s = await createTestStudent(local("glob"), "Emp Global");
    await setOpenToWork(s.id, true);
    process.env.CONTACT_REQUESTS_DAILY_CAP = "0";
    const res = await send(verified, s);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited_global" });
  });

  it("a student can turn open_to_work off, and then no new requests arrive", async () => {
    const s = await createTestStudent(local("off"), "Emp Off");
    const { PATCH } = await import("@/app/api/me/open-to-work/route");
    as(s);
    expect((await PATCH(req("PATCH", { open_to_work: true }))).status).toBe(200);
    expect((await PATCH(req("PATCH", { open_to_work: "yes" }))).status).toBe(400);
    as(s);
    expect((await PATCH(req("PATCH", { open_to_work: false }))).status).toBe(200);
    expect((await send(verified, s)).status).toBe(404);
  });
});
