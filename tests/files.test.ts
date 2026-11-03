import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  approveSubmission,
  getPublicStudent,
  getPublicWork,
  rejectSubmission,
  setFileVisibility,
  setSensitiveFlag,
} from "@/lib/db";
import { FILE_REQUESTS_PER_WINDOW } from "@/lib/file-access";
import { getAdminClient } from "@/lib/supabase/admin";
import type { FileVisibility } from "@/lib/types";

import {
  createTestAdmin,
  createTestEmployer,
  createTestReviewer,
  createTestStudent,
  fields,
  rubricChoices,
  samplePdf,
  submitThroughApiPath,
  type RubricChoice,
  type TestUser,
} from "../scripts/lib/test-data";
import { expected, VIEWERS, type ViewerName } from "./file-access-table";
import { testRun } from "./helpers";

// Route handlers are called directly with a faked session.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

// ------------------------------------------------------- against the database

const local = testRun("file");
let users: Record<Exclude<ViewerName, "anonymous">, TestUser>;
let simple: RubricChoice;
const subs: Record<string, string> = {}; // label -> submission id
const paths: Record<string, string> = {}; // label -> storage path (must never show up publicly)
let ipCounter = 0;

const pdf = (label: string) => ({
  bytes: samplePdf(`${local("")}${label}`),
  name: "Passport_Ali_AA1234567.pdf", // a name that must never reach a URL
  contentType: "application/pdf" as const,
});

async function submit(label: string): Promise<string> {
  const { created, path } = await submitThroughApiPath(
    users.owner.id,
    fields({ type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: "2025-10-15", title: `[TEST] ${label}` }),
    pdf(label),
  );
  if (!created || !created.ok) throw new Error(`submit ${label} failed: ${JSON.stringify(created)}`);
  subs[label] = created.id;
  paths[label] = path!;
  return created.id;
}

async function approve(id: string) {
  const res = await approveSubmission(id, users.reviewer.id, simple.type_id, simple.level, simple.result);
  if (!res.ok) throw new Error(res.message);
}

type FileHandler = (req: Request, ctx: { params: Promise<{ submissionId: string }> }) => Promise<Response>;
async function fetchFile(viewer: ViewerName, submissionId: string, ip?: string): Promise<Response> {
  const { GET } = (await import("@/app/api/files/[submissionId]/route")) as unknown as { GET: FileHandler };
  session.userId = viewer === "anonymous" ? null : users[viewer].id;
  // A fresh IP per anonymous call, so the rate limit only trips where a test wants it to.
  const headers = { "x-forwarded-for": ip ?? `198.51.100.${(ipCounter++ % 250) + 1}, 10.0.0.1` };
  return GET(new Request(`http://test.local/api/files/${submissionId}`, { headers }), {
    params: Promise.resolve({ submissionId }),
  });
}

beforeAll(async () => {
  const [owner, otherStudent, employer, verifiedEmployer, reviewer, admin] = await Promise.all([
    createTestStudent(local("owner"), "File Owner"),
    createTestStudent(local("other"), "File Other"),
    createTestEmployer(local("employer"), "File Employer", false),
    createTestEmployer(local("verified"), "File Verified Employer", true),
    createTestReviewer(local("reviewer"), "File Reviewer"),
    createTestAdmin(local("admin"), "File Admin"),
  ]);
  users = { owner, otherStudent, employer, verifiedEmployer, reviewer, admin };
  const { rows } = await rubricChoices();
  simple = rows.find((r) => !r.certificate_ref_required)!;

  for (const label of ["private", "verified", "public", "flagged"]) await approve(await submit(label));
  await submit("pending");
  const rejected = await submit("rejected");
  const r = await rejectSubmission(rejected, users.reviewer.id, "TEST: rejected");
  if (!r.ok) throw new Error(r.message);

  const set = async (label: string, v: FileVisibility, confirm = false) => {
    const res = await setFileVisibility(users.owner.id, subs[label], v, confirm);
    if (!res.ok) throw new Error(res.message);
  };
  await set("private", "private");
  await set("public", "public", true);
  await set("flagged", "public", true);
  const flag = await setSensitiveFlag(users.reviewer.id, subs.flagged, true);
  if (!flag.ok) throw new Error(flag.message);
});

describe("GET /api/files/:submissionId", () => {
  it("every approved visibility (and the flag) x every viewer role: 302 when allowed, else 404 signed out / 403 signed in", async () => {
    const cases: [string, FileVisibility, boolean][] = [
      ["private", "private", false],
      ["verified", "verified", false],
      ["public", "public", false],
      ["flagged", "private", true], // was public, the reviewer's flag made it private
    ];
    for (const [label, visibility, flagged] of cases) {
      for (const viewer of VIEWERS) {
        const res = await fetchFile(viewer, subs[label]);
        const allowed = expected(viewer, visibility, flagged);
        const want = allowed ? 302 : viewer === "anonymous" ? 404 : 403;
        expect(res.status, `${label} as ${viewer}`).toBe(want);
        expect(res.headers.get("x-robots-tag"), `${label} as ${viewer}`).toBe("noindex, nofollow");
        expect(res.headers.get("cache-control")).toBe("private, no-store");
        if (allowed) {
          const location = res.headers.get("location")!;
          expect(location).toContain(`/${subs[label]}/document.pdf`);
          expect(location).toContain("token=");
          // Neutral object name: no student id, no original file name.
          expect(location).not.toContain(users.owner.id);
          expect(location).not.toContain("Passport");
        } else {
          expect(await res.text()).not.toContain(paths[label]);
        }
      }
    }
  });

  it("a signed-out viewer can never read private or verified files", async () => {
    for (const label of ["private", "verified", "flagged"]) expect((await fetchFile("anonymous", subs[label])).status).toBe(404);
  });

  it("pending and rejected submissions never return a file, not even to the owner, reviewers or admins", async () => {
    for (const label of ["pending", "rejected"]) {
      for (const viewer of VIEWERS) {
        const res = await fetchFile(viewer, subs[label]);
        expect(res.status, `${label} as ${viewer}`).toBe(404);
        expect(res.headers.get("location")).toBeNull();
      }
    }
  });

  it("unknown and malformed ids are 404", async () => {
    expect((await fetchFile("admin", crypto.randomUUID())).status).toBe(404);
    expect((await fetchFile("admin", "not-a-uuid")).status).toBe(404);
  });

  it(`is rate limited: request ${FILE_REQUESTS_PER_WINDOW + 1} from one IP in the window gets 429`, async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
    for (let i = 0; i < FILE_REQUESTS_PER_WINDOW; i++) {
      expect((await fetchFile("anonymous", subs.public, ip)).status).toBe(302);
    }
    const blocked = await fetchFile("anonymous", subs.public, ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    // Another IP is not affected.
    expect((await fetchFile("anonymous", subs.public)).status).toBe(302);
    // The log never stores the raw IP.
    const { data } = await getAdminClient().from("file_access_log").select("client_key").eq("submission_id", subs.public);
    expect((data ?? []).some((r) => (r.client_key as string).includes(ip))).toBe(false);
  });
});

describe("set_file_visibility() and set_sensitive_flag()", () => {
  it("public needs the confirmation and stores public_confirmed_at; leaving public clears it", async () => {
    expect(await setFileVisibility(users.owner.id, subs.verified, "public", false)).toEqual({ ok: false, message: "confirmation required" });
    expect(await setFileVisibility(users.owner.id, subs.verified, "public", true)).toEqual({ ok: true });
    const row = async () =>
      (await getAdminClient().from("submissions").select("file_visibility, public_confirmed_at").eq("id", subs.verified).single()).data!;
    expect((await row()).public_confirmed_at).not.toBeNull();
    expect(await setFileVisibility(users.owner.id, subs.verified, "verified", false)).toEqual({ ok: true });
    expect(await row()).toMatchObject({ file_visibility: "verified", public_confirmed_at: null });
  });

  it("only the owner, and only for approved, unflagged work", async () => {
    for (const other of ["otherStudent", "reviewer", "admin"] as const) {
      expect(await setFileVisibility(users[other].id, subs.private, "verified", false)).toEqual({ ok: false, message: "submission not found" });
    }
    expect(await setFileVisibility(users.owner.id, subs.pending, "private", false)).toEqual({ ok: false, message: "submission is not approved" });
    expect(await setFileVisibility(users.owner.id, subs.flagged, "public", true)).toEqual({ ok: false, message: "file is flagged as sensitive" });
  });

  it("the database itself refuses public without confirmation and a flagged file that is not private", async () => {
    const db = getAdminClient();
    const a = await db.from("submissions").update({ file_visibility: "public", public_confirmed_at: null }).eq("id", subs.private);
    expect(a.error?.code).toBe("23514");
    const b = await db.from("submissions").update({ file_visibility: "verified" }).eq("id", subs.flagged);
    expect(b.error?.code).toBe("23514");
  });

  it("flagging makes the file private; only active reviewers and admins may flag, never the owner", async () => {
    const row = (await getAdminClient().from("submissions").select("file_visibility, sensitive_data_flag, public_confirmed_at").eq("id", subs.flagged).single()).data;
    expect(row).toEqual({ file_visibility: "private", sensitive_data_flag: true, public_confirmed_at: null });
    expect(await setSensitiveFlag(users.owner.id, subs.private, true)).toEqual({ ok: false, message: "not an active reviewer" });
    expect(await setSensitiveFlag(users.verifiedEmployer.id, subs.private, true)).toEqual({ ok: false, message: "not an active reviewer" });
    expect(await setSensitiveFlag(users.admin.id, crypto.randomUUID(), true)).toEqual({ ok: false, message: "submission not found" });
  });

  it("every change writes an audit row", async () => {
    const { data } = await getAdminClient()
      .from("audit_log")
      .select("action, entity_id, actor_id")
      .in("action", ["submission.visibility", "submission.sensitive_flag"])
      .in("entity_id", [subs.public, subs.flagged, subs.verified]);
    const actions = (data ?? []).map((r) => `${r.action}:${r.entity_id === subs.flagged ? "flagged" : "other"}`);
    expect(actions).toEqual(expect.arrayContaining(["submission.visibility:other", "submission.sensitive_flag:flagged"]));
  });
});

describe("visibility and sensitive routes", () => {
  type Patch = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
  const patch = async (path: string, as: ViewerName, id: string, body: unknown) => {
    const { PATCH } = (await import(path)) as { PATCH: Patch };
    session.userId = as === "anonymous" ? null : users[as].id;
    return PATCH(
      new Request("http://test.local", { method: "PATCH", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
      { params: Promise.resolve({ id }) },
    );
  };
  const visibility = (as: ViewerName, id: string, body: unknown) => patch("@/app/api/submissions/[id]/visibility/route", as, id, body);
  const sensitive = (as: ViewerName, id: string, body: unknown) => patch("@/app/api/review/submissions/[id]/sensitive/route", as, id, body);

  it("PATCH visibility: public needs confirm; strangers and signed-out users cannot change it", async () => {
    expect((await visibility("owner", subs.private, { visibility: "public" })).status).toBe(400);
    expect(await (await visibility("owner", subs.private, { visibility: "public" })).json()).toEqual({ error: "confirmation_required" });
    expect((await visibility("owner", subs.private, { visibility: "verified" })).status).toBe(200);
    expect((await visibility("owner", subs.private, { visibility: "private" })).status).toBe(200);
    expect((await visibility("otherStudent", subs.private, { visibility: "verified" })).status).toBe(404);
    expect((await visibility("anonymous", subs.private, { visibility: "verified" })).status).toBe(401);
    expect((await visibility("owner", subs.flagged, { visibility: "public", confirm: true })).status).toBe(409);
    expect((await visibility("owner", subs.private, { visibility: "everyone" })).status).toBe(400);
  });

  it("PATCH sensitive: reviewers only", async () => {
    expect((await sensitive("owner", subs.private, { flag: true })).status).toBe(403);
    expect((await sensitive("anonymous", subs.private, { flag: true })).status).toBe(401);
    expect((await sensitive("reviewer", subs.private, { flag: "yes" })).status).toBe(400);
  });
});

describe("no storage path in any public response", () => {
  const LEAK = /file_path|\/proofs\/|\/object\/sign\/|document\.(pdf|png|jpe?g)|sensitive|file_visibility/i; // avatars may use public storage URLs

  it("every public GET route, called signed out with student and submission ids, carries no path, URL or flag", async () => {
    session.userId = null;
    const API = join(process.cwd(), "src/app/api");
    const files = (readdirSync(API, { recursive: true }) as string[]).filter((f) => f.endsWith("route.ts"));
    type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
    let scanned = 0;
    for (const file of files) {
      const rel = relative(API, join(API, file));
      const mod = (await import(join(API, file))) as Record<string, unknown>;
      if (typeof mod.GET !== "function") continue;
      for (const id of [users.owner.id, subs.public, subs.private]) {
        const params = Object.fromEntries([...rel.matchAll(/\[(\w+)\]/g)].map((m) => [m[1], id]));
        const res = await (mod.GET as Handler)(
          new Request("http://test.local/api/x", { headers: { "x-forwarded-for": `192.0.2.${(ipCounter++ % 250) + 1}` } }),
          { params: Promise.resolve(params) },
        );
        // The files route answers a public file with a redirect; its body is empty and the URL is the neutral one.
        if (rel.startsWith("files/")) {
          const body = await res.text();
          if (res.status === 302) expect(res.headers.get("location"), rel).not.toContain(users.owner.id);
          else expect(Object.keys(JSON.parse(body)), rel).toEqual(["error"]);
          continue;
        }
        if (res.status !== 200) continue;
        scanned++;
        const text = await res.text();
        for (const p of Object.values(paths)) expect(text, rel).not.toContain(p);
        expect(text.match(LEAK)?.[0] ?? null, rel).toBeNull();
      }
    }
    expect(scanned).toBeGreaterThan(0);
  });

  it("the data behind the public profile and work pages has no path or flag", async () => {
    const values = [await getPublicStudent(users.owner.id), await getPublicWork(subs.public), await getPublicWork(subs.flagged)];
    for (const v of values) {
      const text = JSON.stringify(v);
      for (const p of Object.values(paths)) expect(text).not.toContain(p);
      expect(text.match(LEAK)?.[0] ?? null).toBeNull();
    }
    expect(values[1]).toMatchObject({ file_public: true, issuer: expect.any(String) });
    expect(values[2]).toMatchObject({ file_public: false });
    // Pending and rejected work has no public page.
    expect(await getPublicWork(subs.pending)).toBeNull();
    expect(await getPublicWork(subs.rejected)).toBeNull();
  });
});
