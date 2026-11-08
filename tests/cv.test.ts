import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import {
  approveSubmission,
  createContactRequest,
  respondContactRequest,
  saveCv,
  setCvVisibility,
  setOpenToWork,
} from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";
import { CV_VISIBILITIES, type CvVisibility } from "@/lib/types";
import { cvBodySchema } from "@/lib/validation";

import {
  createTestAdmin,
  createTestEmployer,
  createTestReviewer,
  createTestStudent,
  insertPendingRow,
  rubricChoices,
  setProfileStatus,
  type TestUser,
} from "../scripts/lib/test-data";
import { validCv } from "./cv-fixtures";
import { testRun } from "./helpers";

// The CV through its real route handlers (CLAUDE.md rule 12). The session is faked at getClaims(), as in
// tests/employers.test.ts, so the real role lookups, cvAccess() and the SQL functions decide.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

const local = testRun("cv");
const db = () => getAdminClient();
const MARK = `CVMARK${Date.now().toString(36)}`;

let owner: TestUser;
let other: TestUser;
let reviewer: TestUser;
let admin: TestUser;
let employer: TestUser; // unverified
let verified: TestUser;
let accepted: TestUser; // unverified, with an accepted contact request from owner
let hidden: TestUser; // has a public CV and an accepted request, then hidden
let blank: TestUser; // never saved a CV

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
const as = (u: TestUser | null) => {
  session.userId = u?.id ?? null;
};
const req = (method: string, body?: unknown) =>
  new Request("http://test.local/api/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function getCv(studentId: string) {
  const { GET } = (await import("@/app/api/cv/[studentId]/route")) as unknown as { GET: Handler };
  return GET(req("GET"), { params: Promise.resolve({ studentId }) });
}

const CONTACT_KEY = /^contact/;
function keys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keys);
  if (value && typeof value === "object") return Object.entries(value).flatMap(([k, v]) => [k, ...keys(v)]);
  return [];
}

async function acceptRequest(employerUser: TestUser, student: TestUser) {
  const created = await createContactRequest(employerUser.id, student.id, "TEST message", 1000);
  expect(created.ok).toBe(true);
  if (!created.ok) return;
  expect(await respondContactRequest(student.id, created.data, { action: "accept", kind: "telegram", value: "@test_user" })).toEqual({
    ok: true,
    data: null,
  });
}

async function cvViewCount(actor: TestUser, action: string, studentId: string) {
  const { count } = await db()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actor.id)
    .eq("action", action)
    .eq("entity_id", studentId);
  return count ?? 0;
}

beforeAll(async () => {
  [owner, other, reviewer, admin, employer, verified, accepted, hidden, blank] = await Promise.all([
    createTestStudent(local("owner"), "Cv Owner"),
    createTestStudent(local("other"), "Cv Other"),
    createTestReviewer(local("reviewer"), "Cv Reviewer"),
    createTestAdmin(local("admin"), "Cv Admin"),
    createTestEmployer(local("employer"), "Cv Employer", false),
    createTestEmployer(local("verified"), "Cv Verified", true),
    createTestEmployer(local("accepted"), "Cv Accepted", false),
    createTestStudent(local("hidden"), "Cv Hidden"),
    createTestStudent(local("blank"), "Cv Blank"),
  ]);

  const body = cvBodySchema.parse({ ...validCv(), about: `${MARK} <script>alert(1)</script>` });
  for (const s of [owner, hidden]) {
    const saved = await saveCv(s.id, body);
    expect(saved.ok).toBe(true);
    expect(await setOpenToWork(s.id, true)).toEqual({ ok: true, data: true });
    await acceptRequest(accepted, s);
  }
  expect((await setCvVisibility(hidden.id, "public", true)).ok).toBe(true);
  await setProfileStatus(hidden.id, "hidden");

  const c = (await rubricChoices()).rows[0];
  const id = await insertPendingRow(owner.id, { type_id: c.type_id, level: c.level, result: c.result, achievement_date: "2025-10-01" });
  expect((await approveSubmission(id, reviewer.id, c.type_id, c.level, c.result)).ok).toBe(true);
});

afterEach(() => as(null));

// ------------------------------------------------------------------ access matrix

type Seen = "full" | "noContacts" | "public" | 404;
const MATRIX: Record<string, Record<CvVisibility, Seen>> = {
  owner: { private: "full", verified: "full", public: "full" },
  admin: { private: "full", verified: "full", public: "full" },
  accepted: { private: "full", verified: "full", public: "full" },
  verified: { private: 404, verified: "noContacts", public: "noContacts" },
  employer: { private: 404, verified: 404, public: "public" },
  other: { private: 404, verified: 404, public: "public" },
  reviewer: { private: 404, verified: 404, public: "public" },
  anonymous: { private: 404, verified: 404, public: "public" },
};

describe("GET /api/cv/:id access matrix", () => {
  const viewers = () => ({ owner, admin, accepted, verified, employer, other, reviewer, anonymous: null }) as Record<string, TestUser | null>;

  for (const visibility of CV_VISIBILITIES) {
    it(`cv_visibility = ${visibility}`, async () => {
      expect((await setCvVisibility(owner.id, visibility, true)).ok).toBe(true);
      for (const [name, user] of Object.entries(viewers())) {
        as(user);
        const res = await getCv(owner.id);
        const expected = MATRIX[name][visibility];
        expect(res.status, `${name} × ${visibility}`).toBe(expected === 404 ? 404 : 200);
        expect(res.headers.get("cache-control"), name).toContain("no-store");
        expect(res.headers.get("x-robots-tag"), name).toContain("noindex");
        const json = (await res.json()) as Record<string, unknown>;
        if (expected === 404) {
          expect(json).toEqual({ error: "not_found" });
          continue;
        }
        const contactKeys = keys(json).filter((k) => CONTACT_KEY.test(k));
        if (expected === "full") {
          expect(json.contacts, name).toMatchObject({ contact_phone: "+998 90 123 45 67", contact_telegram: "@test_user" });
          expect(json.course, name).toBeTypeOf("number");
        } else {
          expect(contactKeys, `${name} × ${visibility}`).toEqual([]);
          expect(JSON.stringify(json)).not.toContain("+998 90 123 45 67");
          expect(JSON.stringify(json)).not.toContain("test@example.invalid");
          expect("course" in json, `${name} × ${visibility} course`).toBe(expected === "noContacts");
        }
        // The stored text comes back as data (escaping is the renderer's job, see cv-validation.test.ts).
        expect((json.content as { about: string }).about).toContain(MARK);
        // Verified achievements: metadata only, no points or rank.
        expect((json.works as unknown[]).length).toBe(1);
        expect(keys(json).filter((k) => /(^|_)(points?|rank|score)($|_)/.test(k))).toEqual([]);
      }
    });
  }

  it("logs employer and admin views in audit_log, not the owner's", async () => {
    expect((await setCvVisibility(owner.id, "public", true)).ok).toBe(true);
    const before = await Promise.all([
      cvViewCount(employer, "employer.cv_viewed", owner.id),
      cvViewCount(admin, "admin.cv_viewed", owner.id),
      cvViewCount(owner, "employer.cv_viewed", owner.id),
    ]);
    for (const u of [employer, admin, owner]) {
      as(u);
      expect((await getCv(owner.id)).status).toBe(200);
    }
    const after = await Promise.all([
      cvViewCount(employer, "employer.cv_viewed", owner.id),
      cvViewCount(admin, "admin.cv_viewed", owner.id),
      cvViewCount(owner, "employer.cv_viewed", owner.id),
    ]);
    expect(after).toEqual([before[0] + 1, before[1] + 1, before[2]]);
  });

  it("a hidden student's CV: only the owner and admins", async () => {
    for (const [user, status] of [
      [null, 404],
      [other, 404],
      [employer, 404],
      [verified, 404],
      [accepted, 404],
      [reviewer, 404],
      [admin, 200],
      [hidden, 200],
    ] as const) {
      as(user);
      expect((await getCv(hidden.id)).status, user?.email ?? "anonymous").toBe(status);
    }
  });

  it("a student who never saved a CV: 404 for everyone else", async () => {
    for (const u of [null, admin, verified]) {
      as(u);
      expect((await getCv(blank.id)).status).toBe(404);
    }
    // The owner sees an empty CV.
    as(blank);
    expect((await getCv(blank.id)).status).toBe(200);
    as(null);
    expect((await getCv("not-a-uuid")).status).toBe(404);
  });
});

// ------------------------------------------------------------------ writes

describe("PUT /api/me/cv and PATCH /api/me/cv/visibility", () => {
  const put = async (body: unknown) => {
    const { PUT } = await import("@/app/api/me/cv/route");
    return PUT(req("PUT", body));
  };
  const patch = async (body: unknown) => {
    const { PATCH } = await import("@/app/api/me/cv/visibility/route");
    return PATCH(req("PATCH", body));
  };

  it("students only: 401 signed out, 403 for employers, reviewers and admins", async () => {
    const { GET } = await import("@/app/api/me/cv/route");
    as(null);
    expect((await GET()).status).toBe(401);
    expect((await put(validCv())).status).toBe(401);
    for (const u of [employer, verified, reviewer, admin]) {
      as(u);
      expect((await GET()).status).toBe(403);
      expect((await put(validCv())).status).toBe(403);
      expect((await patch({ visibility: "private" })).status).toBe(403);
    }
  });

  it("refuses bodies over the limits or with bad URLs (400), saves a valid one", async () => {
    as(other);
    const bad: Record<string, unknown>[] = [
      { about: "a".repeat(601) },
      { skills: Array.from({ length: 21 }, (_, i) => `s${i}`) },
      { links: [{ label: "x", url: "http://example.com" }] },
      { links: [{ label: "x", url: "javascript:alert(1)" }] },
      { experience: [{ title: "t", organization: "o", start: "2024-13", end: null, description: "" }] },
      { cv_visibility: "public" },
    ];
    for (const b of bad) expect((await put({ ...validCv(), ...b })).status, JSON.stringify(b).slice(0, 60)).toBe(400);
    expect((await put("not json")).status).toBe(400);
    const ok = await put(validCv());
    expect(ok.status).toBe(200);
    const { data } = await db().from("student_cvs").select("cv_visibility, contact_email, skills").eq("student_id", other.id).single();
    expect(data).toEqual({ cv_visibility: "private", contact_email: "test@example.invalid", skills: ["SQL", "Python"] });
  });

  it("the database refuses what the schema refuses (save_cv called directly)", async () => {
    const raw = (doc: unknown) => db().rpc("save_cv", { p_student: other.id, p_doc: doc });
    const docs: unknown[] = [
      { ...validCv(), skills: Array.from({ length: 21 }, (_, i) => `s${i}`) },
      { ...validCv(), skills: "SQL" },
      { ...validCv(), skills: [1] },
      { ...validCv(), skills: ["a", "A"] },
      { ...validCv(), languages: [{ name: "x", level: "fluent" }] },
      { ...validCv(), links: [{ label: "x", url: "http://example.com" }] },
      { ...validCv(), links: [{ label: "x", url: "javascript:alert(1)//.com" }] },
      { ...validCv(), links: [{ label: "x", url: "https://user@evil.com" }] },
      { ...validCv(), experience: [{ title: "t", organization: "o", start: "2999-01", end: null, description: "" }] },
      { ...validCv(), experience: [{ title: "t", organization: "o", start: "2024-05", end: "2024-01", description: "" }] },
      { ...validCv(), experience: [{ title: "t", organization: "o", start: "2024-05", end: null }] },
      { ...validCv(), about: "a".repeat(601) },
      { ...validCv(), about: "bell\u0007" },
      { ...validCv(), contact_phone: "call me" },
      { ...validCv(), contact_telegram: "@x" },
      { ...validCv(), extra: true },
      { about: "" },
      [],
    ];
    for (const doc of docs) {
      const { error } = await raw(doc);
      expect(error?.message, JSON.stringify(doc).slice(0, 80)).toBe("invalid_cv");
    }
  });

  it("'public' needs the confirmation and stores when it was given", async () => {
    as(other);
    const missing = await patch({ visibility: "public" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "confirmation_required" });
    expect((await db().rpc("set_cv_visibility", { p_student: other.id, p_visibility: "public", p_confirm: false })).error?.message).toBe(
      "confirmation_required",
    );

    const res = await patch({ visibility: "public", confirm: true });
    expect(res.status).toBe(200);
    const { data } = await db().from("student_cvs").select("cv_visibility, cv_public_confirmed_at").eq("student_id", other.id).single();
    expect(data?.cv_visibility).toBe("public");
    expect(data?.cv_public_confirmed_at).not.toBeNull();

    expect((await patch({ visibility: "verified" })).status).toBe(200);
    const after = await db().from("student_cvs").select("cv_public_confirmed_at").eq("student_id", other.id).single();
    expect(after.data?.cv_public_confirmed_at).toBeNull();

    const { data: audit } = await db().from("audit_log").select("details").eq("action", "cv.visibility").eq("actor_id", other.id);
    expect(audit?.map((a) => (a.details as { new: string }).new)).toEqual(expect.arrayContaining(["public", "verified"]));
  });

  it("audit rows for saves name the sections only, never the text or contacts", async () => {
    as(other);
    expect((await put({ ...validCv(), about: `${MARK} audit`, contact_phone: "+998 91 111 22 33" })).status).toBe(200);
    const { data } = await db().from("audit_log").select("details").eq("action", "cv.updated").eq("actor_id", other.id);
    const text = JSON.stringify(data);
    expect(text).not.toContain(MARK);
    expect(text).not.toContain("+998");
    expect(text).toContain("about");
    expect(text).toContain("contacts");
  });

  it("rate limits writes (429)", async () => {
    as(other);
    await db().from("student_cvs").update({ write_window_start: new Date().toISOString(), write_count: 60 }).eq("student_id", other.id);
    const res = await put(validCv());
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "rate_limited" });
    expect((await patch({ visibility: "private" })).status).toBe(429);
    // An old window starts over.
    await db()
      .from("student_cvs")
      .update({ write_window_start: new Date(Date.now() - 2 * 3_600_000).toISOString(), write_count: 60 })
      .eq("student_id", other.id);
    expect((await put(validCv())).status).toBe(200);
  });
});

// ------------------------------------------------------------------ no CV data in listings

describe("no CV data outside the CV routes", () => {
  it("public and directory responses never carry CV text or contacts", async () => {
    expect((await setCvVisibility(owner.id, "public", true)).ok).toBe(true);
    const calls: [string, TestUser | null, () => Promise<Response>][] = [
      ["leaderboard", null, async () => (await import("@/app/api/leaderboard/route")).GET(new Request("http://test.local/api/leaderboard?academic_year=all"))],
      [
        "leaderboard/:id",
        null,
        async () =>
          ((await import("@/app/api/leaderboard/[studentId]/route")) as unknown as { GET: Handler }).GET(req("GET"), {
            params: Promise.resolve({ studentId: owner.id }),
          }),
      ],
      ["talent", verified, async () => (await import("@/app/api/talent/route")).GET(new Request("http://test.local/api/talent"))],
      [
        "talent/:id",
        accepted,
        async () =>
          ((await import("@/app/api/talent/[studentId]/route")) as unknown as { GET: Handler }).GET(req("GET"), {
            params: Promise.resolve({ studentId: owner.id }),
          }),
      ],
    ];
    for (const [name, user, call] of calls) {
      as(user);
      const res = await call();
      expect(res.status, name).toBe(200);
      const text = await res.text();
      expect(text, name).not.toContain(MARK);
      expect(text, name).not.toContain("+998 90 123 45 67");
      expect(text, name).not.toMatch(/"(about|skills|languages|experience|links|contact_phone|contact_city|cv_visibility)"/);
    }
  });

  it("the directory says only whether the CV can be opened", async () => {
    const { GET } = await import("@/app/api/talent/route");
    const row = async (u: TestUser) => {
      as(u);
      // The owner may be on any page of the directory; walk them all.
      for (let page = 1; page < 100; page++) {
        const list = (await (await GET(new Request(`http://test.local/api/talent?page=${page}`))).json()) as {
          rows: { student_id: string; cv_available: boolean }[];
          total: number;
          page_size: number;
        };
        const hit = list.rows.find((r) => r.student_id === owner.id);
        if (hit) return hit;
        if (page * list.page_size >= list.total) break;
      }
      return undefined;
    };
    expect((await setCvVisibility(owner.id, "verified", true)).ok).toBe(true);
    expect((await row(verified))?.cv_available).toBe(true);
    expect((await row(employer))?.cv_available).toBe(false);
    expect((await row(accepted))?.cv_available).toBe(true);
    expect((await setCvVisibility(owner.id, "private", true)).ok).toBe(true);
    expect((await row(verified))?.cv_available).toBe(false);
    expect((await row(accepted))?.cv_available).toBe(true);
  });
});
