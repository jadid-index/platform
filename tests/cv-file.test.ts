import { readFileSync } from "node:fs";

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { cleanupCvUploads, CV_FILE_REQUESTS_PER_WINDOW } from "@/lib/cv-file";
import { createContactRequest, respondContactRequest, saveCv, setCvVisibility, setOpenToWork } from "@/lib/db";
import { extractForStudent } from "@/lib/extraction";
import { getAdminClient } from "@/lib/supabase/admin";
import { CV_VISIBILITIES, type CvVisibility } from "@/lib/types";
import { cvBodySchema, CV_FILE_MAX_BYTES } from "@/lib/validation";

import {
  createTestAdmin,
  createTestEmployer,
  createTestReviewer,
  createTestStudent,
  samplePdf,
  setProfileStatus,
  type TestUser,
} from "../scripts/lib/test-data";
import { validCv } from "./cv-fixtures";
import { testRun } from "./helpers";

// The uploaded CV through its real route handlers and the real private bucket (migration 20261109000000).
// The session is faked at getClaims(), as in tests/cv.test.ts.
const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/supabase/server", () => ({
  createSessionClient: async () => ({
    auth: {
      getClaims: async () =>
        session.userId ? { data: { claims: { sub: session.userId, user_metadata: {} } }, error: null } : { data: null, error: null },
    },
  }),
}));

const local = testRun("cvfile");
const db = () => getAdminClient();

let owner: TestUser; // the main student
let other: TestUser; // another student
let reviewer: TestUser;
let admin: TestUser;
let employer: TestUser; // unverified
let verified: TestUser;
let accepted: TestUser; // unverified, accepted contact request from owner and hidden
let hidden: TestUser; // public CV with a file, then hidden
let noRow: TestUser; // a file but never saved a CV nor set visibility

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
type Plain = (req: Request) => Promise<Response>;

const as = (u: TestUser | null) => {
  session.userId = u?.id ?? null;
};
let ipCounter = 0;
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://test.local/api/x", {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": `10.9.${ipCounter >> 8}.${ipCounter++ & 255}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// Everything a response showed: status, headers and body, for the "no storage path" scan.
const seen: { where: string; text: string }[] = [];
async function record(where: string, res: Response, skipHeader?: string): Promise<unknown> {
  const headers = [...res.headers.entries()].filter(([k]) => k !== skipHeader).map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = res.status === 302 ? "" : await res.clone().text();
  seen.push({ where, text: `${headers}\n${text}` });
  return text ? JSON.parse(text) : null;
}

const routes = {
  uploadUrl: async () => (await import("@/app/api/me/cv/file/upload-url/route")) as unknown as { POST: Plain },
  file: async () => (await import("@/app/api/me/cv/file/route")) as unknown as { POST: Plain; DELETE: Plain },
  download: async () => (await import("@/app/api/cv/[studentId]/file/route")) as unknown as { GET: Handler },
  visibility: async () => (await import("@/app/api/me/cv/visibility/route")) as unknown as { PATCH: Plain },
  talent: async () => (await import("@/app/api/talent/route")) as unknown as { GET: Plain },
  cleanup: async () => (await import("@/app/api/admin/cv-files/cleanup/route")) as unknown as { POST: () => Promise<Response> },
};

async function requestUpload(user: TestUser | null, body: Record<string, unknown>) {
  as(user);
  const res = await (await routes.uploadUrl()).POST(req("POST", body));
  // The one-time upload URL necessarily names the object; every other field must not.
  const json = (await res.clone().json()) as { upload_id?: string; upload_url?: string; error?: string };
  seen.push({ where: "upload-url", text: JSON.stringify({ ...json, upload_url: undefined }) });
  return { status: res.status, json };
}

async function put(uploadUrl: string, bytes: Uint8Array) {
  return fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": "application/pdf",
      "x-upsert": "false",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    },
    body: Buffer.from(bytes),
  });
}

async function finalize(user: TestUser, body: Record<string, unknown>) {
  as(user);
  const res = await (await routes.file()).POST(req("POST", body));
  return { status: res.status, json: (await record("finalize", res)) as Record<string, unknown> };
}

// The three steps as the browser does them.
async function upload(user: TestUser, bytes: Uint8Array, name = "Passport_Ali_AA1234567.pdf", confirm = false) {
  const issued = await requestUpload(user, {
    file_name: name,
    size: bytes.length,
    content_type: "application/pdf",
    ...(confirm ? { confirm_public: true } : {}),
  });
  expect(issued.status, JSON.stringify(issued.json)).toBe(200);
  const stored = await put(issued.json.upload_url!, bytes);
  expect(stored.ok, await stored.clone().text()).toBe(true);
  const done = await finalize(user, { upload_id: issued.json.upload_id, ...(confirm ? { confirm_public: true } : {}) });
  return { id: issued.json.upload_id!, ...done };
}

async function row(id: string) {
  const { data, error } = await db().from("cv_files").select("state, object_name, student_id").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as { state: string; object_name: string; student_id: string } | null;
}

async function objectExists(name: string): Promise<boolean> {
  const { data } = await db().storage.from("cvs").download(name);
  return data !== null;
}

async function currentObject(studentId: string): Promise<string | null> {
  const { data } = await db().from("cv_files").select("object_name").eq("student_id", studentId).eq("state", "current").maybeSingle();
  return (data?.object_name as string | undefined) ?? null;
}

async function download(viewer: TestUser | null, studentId: string) {
  as(viewer);
  const res = await (await routes.download()).GET(req("GET"), { params: Promise.resolve({ studentId }) });
  await record(`download ${viewer?.email ?? "anonymous"}`, res, "location");
  return res;
}

async function auditCount(actor: TestUser, action: string, studentId: string) {
  const { count } = await db()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", actor.id)
    .eq("action", action)
    .eq("entity_id", studentId);
  return count ?? 0;
}

async function setVisibility(user: TestUser, body: Record<string, unknown>) {
  as(user);
  const res = await (await routes.visibility()).PATCH(req("PATCH", body));
  return { status: res.status, json: (await record("visibility", res)) as Record<string, unknown> };
}

const encrypted = () =>
  new Uint8Array(
    Buffer.from(
      "%PDF-1.6\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\ntrailer\n<< /Root 1 0 R /Encrypt 5 0 R >>\n%%EOF\n",
      "latin1",
    ),
  );
const withJavaScript = () =>
  new Uint8Array(
    Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R /OpenAction 4 0 R >>\nendobj\n4 0 obj\n<< /S /JavaScript /JS (app.alert(1)) >>\nendobj\n%%EOF\n",
      "latin1",
    ),
  );
const exe = () => {
  const b = new Uint8Array(2048);
  b.set(Buffer.from("MZ\x90\x00\x03\x00This program cannot be run in DOS mode.", "latin1"));
  return b;
};

beforeAll(async () => {
  [owner, other, reviewer, admin, employer, verified, accepted, hidden, noRow] = await Promise.all([
    createTestStudent(local("owner"), "CvFile Owner"),
    createTestStudent(local("other"), "CvFile Other"),
    createTestReviewer(local("reviewer"), "CvFile Reviewer"),
    createTestAdmin(local("admin"), "CvFile Admin"),
    createTestEmployer(local("employer"), "CvFile Employer", false),
    createTestEmployer(local("verified"), "CvFile Verified", true),
    createTestEmployer(local("accepted"), "CvFile Accepted", false),
    createTestStudent(local("hidden"), "CvFile Hidden"),
    createTestStudent(local("norow"), "CvFile NoRow"),
  ]);
  const body = cvBodySchema.parse(validCv());
  for (const s of [owner, hidden]) {
    expect((await saveCv(s.id, body)).ok).toBe(true);
    expect(await setOpenToWork(s.id, true)).toEqual({ ok: true, data: true });
    const created = await createContactRequest(accepted.id, s.id, "TEST message", 1000);
    if (!created.ok) throw new Error(created.code);
    await respondContactRequest(s.id, created.data, { action: "accept", kind: "telegram", value: "@test_user" });
  }
});

afterEach(() => as(null));

// ----------------------------------------------------------------- step 1

describe("POST /api/me/cv/file/upload-url", () => {
  it("checks the declared type and size and who is asking", async () => {
    const ok = { file_name: "cv.pdf", size: 1000, content_type: "application/pdf" };
    expect((await requestUpload(owner, { ...ok, size: CV_FILE_MAX_BYTES + 1 })).json).toEqual({ error: "file_too_large" });
    expect((await requestUpload(owner, { ...ok, content_type: "application/x-msdownload" })).json).toEqual({ error: "file_type" });
    expect((await requestUpload(owner, { ...ok, file_name: "setup.exe" })).json).toEqual({ error: "file_type" });
    expect((await requestUpload(owner, { ...ok, path: "x/y.pdf" })).json).toEqual({ error: "invalid_body" });
    expect((await requestUpload(null, ok)).status).toBe(401);
    expect((await requestUpload(employer, ok)).status).toBe(403);
    expect((await requestUpload(reviewer, ok)).status).toBe(403);
    const issued = await requestUpload(owner, ok);
    expect(issued.status).toBe(200);
    expect(Object.keys(issued.json).sort()).toEqual(["upload_id", "upload_url"]);
    // The object name is the student id and a random id, never the file name.
    const r = await row(issued.json.upload_id!);
    expect(r?.object_name).toBe(`${owner.id}/${issued.json.upload_id}.pdf`);
    expect(r?.state).toBe("pending");
  });
});

describe("upload-url rate limit", () => {
  it("at most 10 upload URLs per student per hour", async () => {
    const student = await createTestStudent(local("limit"), "CvFile Limit");
    const body = { file_name: "cv.pdf", size: 500, content_type: "application/pdf" };
    for (let i = 0; i < 10; i++) expect((await requestUpload(student, body)).status).toBe(200);
    expect(await requestUpload(student, body)).toEqual({ status: 429, json: { error: "rate_limited" } });
  });
});

// ----------------------------------------------------------------- step 3: the screen

describe("finalize refuses bad files and deletes them", () => {
  it.each([
    ["an .exe renamed to .pdf", exe, "file_type"],
    ["an encrypted PDF", encrypted, "pdf_encrypted"],
    ["a PDF with /JavaScript", withJavaScript, "pdf_active_content"],
  ])("%s", async (_label, make, code) => {
    const issued = await requestUpload(owner, { file_name: "cv.pdf", size: make().length, content_type: "application/pdf" });
    const name = (await row(issued.json.upload_id!))!.object_name;
    expect((await put(issued.json.upload_url!, make())).ok).toBe(true);
    expect(await objectExists(name)).toBe(true);
    const done = await finalize(owner, { upload_id: issued.json.upload_id });
    expect(done).toEqual({ status: 400, json: { error: code } });
    expect(await objectExists(name)).toBe(false);
    expect((await row(issued.json.upload_id!))?.state).toBe("removed");
    // The refused upload cannot be finalized later.
    expect((await finalize(owner, { upload_id: issued.json.upload_id })).json).toEqual({ error: "invalid_upload" });
  });

  it("an oversize file never lands (bucket limit) and finalize reports it missing", async () => {
    const big = new Uint8Array(CV_FILE_MAX_BYTES + 1024);
    big.set(samplePdf("big"));
    const issued = await requestUpload(owner, { file_name: "cv.pdf", size: 1000, content_type: "application/pdf" });
    expect((await put(issued.json.upload_url!, big)).ok).toBe(false);
    expect((await finalize(owner, { upload_id: issued.json.upload_id })).json).toEqual({ error: "file_missing" });
  });

  it("another student's upload id is refused without touching the object", async () => {
    const issued = await requestUpload(owner, { file_name: "cv.pdf", size: 500, content_type: "application/pdf" });
    expect((await put(issued.json.upload_url!, samplePdf("foreign"))).ok).toBe(true);
    const name = (await row(issued.json.upload_id!))!.object_name;
    expect((await finalize(other, { upload_id: issued.json.upload_id })).json).toEqual({ error: "invalid_upload" });
    expect(await objectExists(name)).toBe(true);
  });
});

// ----------------------------------------------------------------- upload, replace, delete

describe("upload, replace and delete", () => {
  it("replacing deletes the old object; deleting removes the object", async () => {
    const first = await upload(owner, samplePdf("first"));
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ file_name: "Passport_Ali_AA1234567.pdf", size: samplePdf("first").length });
    expect(Object.keys(first.json).sort()).toEqual(["file_name", "size", "uploaded_at"]);
    const firstName = (await currentObject(owner.id))!;
    expect(await objectExists(firstName)).toBe(true);

    const second = await upload(owner, samplePdf("second"), "My CV.pdf");
    expect(second.status).toBe(200);
    const secondName = (await currentObject(owner.id))!;
    expect(secondName).not.toBe(firstName);
    expect(await objectExists(firstName)).toBe(false);
    expect(await objectExists(secondName)).toBe(true);
    expect(await auditCount(owner, "cv.file_uploaded", owner.id)).toBeGreaterThanOrEqual(2);

    as(owner);
    const del = await (await routes.file()).DELETE(req("DELETE"));
    expect(del.status).toBe(200);
    expect(await objectExists(secondName)).toBe(false);
    expect(await currentObject(owner.id)).toBeNull();
    expect((await download(owner, owner.id)).status).toBe(404);
    expect((await (await routes.file()).DELETE(req("DELETE"))).status).toBe(404);
    expect(await auditCount(owner, "cv.file_deleted", owner.id)).toBe(1);
  });
});

// ----------------------------------------------------------------- public needs the file confirmation

describe("public visibility and the uploaded file", () => {
  it("going public with a file needs confirm_file; uploading while public needs confirm_public", async () => {
    expect((await setCvVisibility(owner.id, "private", false)).ok).toBe(true);
    expect((await upload(owner, samplePdf("pub"))).status).toBe(200);

    expect(await setVisibility(owner, { visibility: "public", confirm: true })).toEqual({
      status: 400,
      json: { error: "file_confirmation_required" },
    });
    expect((await setVisibility(owner, { visibility: "public", confirm: true, confirm_file: true })).status).toBe(200);

    // While public: step 1 and step 3 each refuse without the confirmation; the upload is kept for a retry.
    expect((await requestUpload(owner, { file_name: "cv.pdf", size: 500, content_type: "application/pdf" })).json).toEqual({
      error: "file_confirmation_required",
    });
    const issued = await requestUpload(owner, { file_name: "cv.pdf", size: 500, content_type: "application/pdf", confirm_public: true });
    expect((await put(issued.json.upload_url!, samplePdf("pub2"))).ok).toBe(true);
    expect((await finalize(owner, { upload_id: issued.json.upload_id })).json).toEqual({ error: "file_confirmation_required" });
    expect((await row(issued.json.upload_id!))?.state).toBe("pending");
    expect((await finalize(owner, { upload_id: issued.json.upload_id, confirm_public: true })).status).toBe(200);

    // Back to private: immediate.
    expect((await setVisibility(owner, { visibility: "private" })).status).toBe(200);
    expect((await download(null, owner.id)).status).toBe(404);
  });

  it("a student with a file and no typed CV can set visibility", async () => {
    expect((await upload(noRow, samplePdf("norow"))).status).toBe(200);
    expect((await setVisibility(noRow, { visibility: "verified" })).status).toBe(200);
    expect((await download(verified, noRow.id)).status).toBe(302);
    expect((await setVisibility(noRow, { visibility: "private" })).status).toBe(200);
    expect((await download(verified, noRow.id)).status).toBe(404);
  });
});

// ----------------------------------------------------------------- download access matrix

type Expect = 302 | 404;
const MATRIX: Record<string, Record<CvVisibility, Expect>> = {
  owner: { private: 302, verified: 302, public: 302 },
  admin: { private: 302, verified: 302, public: 302 },
  accepted: { private: 302, verified: 302, public: 302 },
  verified: { private: 404, verified: 302, public: 302 },
  employer: { private: 404, verified: 404, public: 302 },
  other: { private: 404, verified: 404, public: 302 },
  reviewer: { private: 404, verified: 404, public: 302 },
  anonymous: { private: 404, verified: 404, public: 302 },
};

const EMPLOYERS = new Set(["accepted", "verified", "employer"]);

function tokenLifetime(location: string): number {
  const token = new URL(location).searchParams.get("token")!;
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { iat: number; exp: number };
  return payload.exp - payload.iat;
}

describe("GET /api/cv/:studentId/file", () => {
  beforeAll(async () => {
    if (!(await currentObject(owner.id))) expect((await upload(owner, samplePdf("matrix"))).status).toBe(200);
  });

  for (const visibility of CV_VISIBILITIES) {
    it(`cv_visibility = ${visibility}`, async () => {
      expect((await setCvVisibility(owner.id, visibility, true, true)).ok).toBe(true);
      const name = (await currentObject(owner.id))!;
      const viewers = { owner, admin, accepted, verified, employer, other, reviewer, anonymous: null } as Record<string, TestUser | null>;
      for (const [label, viewer] of Object.entries(viewers)) {
        // Admin and employer downloads are logged; owner, students, reviewers and anonymous are not.
        const action = label === "admin" ? "admin.cv_file_downloaded" : EMPLOYERS.has(label) ? "employer.cv_file_downloaded" : null;
        const before = viewer && action ? await auditCount(viewer, action, owner.id) : 0;
        const res = await download(viewer, owner.id);
        const want = MATRIX[label][visibility];
        expect(res.status, `${label} × ${visibility}`).toBe(want);
        expect(res.headers.get("x-robots-tag")).toContain("noindex");
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(res.headers.get("cache-control")).toContain("no-store");
        if (want === 404) {
          expect(await res.json()).toEqual({ error: "not_found" });
          continue;
        }
        const location = res.headers.get("location")!;
        expect(location).toContain(`/cvs/${name}`);
        expect(tokenLifetime(location)).toBe(60);
        expect(new URL(location).searchParams.get("download")).toBe("cv.pdf");
        if (viewer && action) expect(await auditCount(viewer, action, owner.id), label).toBe(before + 1);
      }
    });
  }

  it("the signed URL serves the stored PDF (its 60-second lifetime is checked above)", async () => {
    expect((await setCvVisibility(owner.id, "private", false)).ok).toBe(true);
    const res = await download(owner, owner.id);
    const fetched = await fetch(res.headers.get("location")!);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(await fetched.arrayBuffer()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("a hidden student's file: owner and admins only", async () => {
    expect((await upload(hidden, samplePdf("hidden"))).status).toBe(200);
    expect((await setCvVisibility(hidden.id, "public", true, true)).ok).toBe(true);
    expect((await download(null, hidden.id)).status).toBe(302);
    await setProfileStatus(hidden.id, "hidden");
    expect((await download(hidden, hidden.id)).status).toBe(302);
    expect((await download(admin, hidden.id)).status).toBe(302);
    for (const v of [accepted, verified, employer, other, reviewer, null]) expect((await download(v, hidden.id)).status).toBe(404);
  });

  it("unknown ids and students without a file are 404; the route is rate limited", async () => {
    expect((await download(null, "not-a-uuid")).status).toBe(404);
    expect((await download(admin, crypto.randomUUID())).status).toBe(404);
    expect((await download(admin, other.id)).status).toBe(404);
    const rows = Array.from({ length: CV_FILE_REQUESTS_PER_WINDOW }, () => ({
      student_id: owner.id,
      viewer_id: other.id,
      client_key: `user:${other.id}`,
    }));
    await db().from("cv_file_access_log").insert(rows);
    expect((await download(other, owner.id)).status).toBe(429);
  });
});

// ----------------------------------------------------------------- talent

describe("/api/talent", () => {
  it("cv_file_available is a boolean that follows the matrix", async () => {
    expect((await setCvVisibility(owner.id, "verified", true, true)).ok).toBe(true);
    const find = async (viewer: TestUser) => {
      as(viewer);
      const res = await (await routes.talent()).GET(new Request("http://test.local/api/talent"));
      const json = (await record("talent", res)) as { rows: { student_id: string; cv_file_available: boolean }[] };
      return json.rows.find((r) => r.student_id === owner.id);
    };
    expect((await find(verified))?.cv_file_available).toBe(true);
    expect((await find(employer))?.cv_file_available).toBe(false);
    expect((await find(accepted))?.cv_file_available).toBe(true);
  });
});

// ----------------------------------------------------------------- cleanup

describe("cleanup of unfinished uploads", () => {
  it("removes pending objects older than an hour and keeps fresh ones and current files", async () => {
    const make = async (label: string) => {
      const issued = await requestUpload(other, { file_name: "cv.pdf", size: 500, content_type: "application/pdf" });
      expect((await put(issued.json.upload_url!, samplePdf(label))).ok).toBe(true);
      return { id: issued.json.upload_id!, name: (await row(issued.json.upload_id!))!.object_name };
    };
    const stale = await make("stale");
    const fresh = await make("fresh");
    await db().from("cv_files").update({ created_at: new Date(Date.now() - 2 * 3600_000).toISOString() }).eq("id", stale.id);
    const current = await currentObject(owner.id);

    expect(await cleanupCvUploads()).toBeGreaterThanOrEqual(1);
    expect(await objectExists(stale.name)).toBe(false);
    expect((await row(stale.id))?.state).toBe("removed");
    expect(await objectExists(fresh.name)).toBe(true);
    expect((await row(fresh.id))?.state).toBe("pending");
    if (current) expect(await objectExists(current)).toBe(true);
    // A late upload to the expired URL cannot be finalized.
    expect((await finalize(other, { upload_id: stale.id })).json).toEqual({ error: "invalid_upload" });
  });

  it("the admin route runs it; other roles cannot", async () => {
    as(admin);
    const res = await (await routes.cleanup()).POST();
    expect(res.status).toBe(200);
    expect(Object.keys((await record("cleanup", res)) as object)).toEqual(["removed"]);
    for (const u of [owner, reviewer, employer]) {
      as(u);
      expect((await (await routes.cleanup()).POST()).status).toBe(403);
    }
  });
});

// ----------------------------------------------------------------- no storage path, no AI

describe("privacy", () => {
  it("no response shows a storage path", async () => {
    const names = (await db().from("cv_files").select("object_name").in("student_id", [owner.id, other.id, hidden.id, noRow.id]))
      .data!.map((r) => r.object_name as string);
    expect(seen.length).toBeGreaterThan(20);
    for (const { where, text } of seen) {
      expect(text, where).not.toMatch(/\/cvs\//);
      expect(text, where).not.toContain("object_name");
      for (const n of names) expect(text, where).not.toContain(n);
    }
  });

  it("nothing from the CV reaches the AI route", async () => {
    // noRow: the other test students have used their 10 upload URLs this hour.
    const issued = await requestUpload(noRow, { file_name: "cv.pdf", size: 500, content_type: "application/pdf" });
    expect(issued.status, JSON.stringify(issued.json)).toBe(200);
    const name = (await row(issued.json.upload_id!))!.object_name;
    const call = vi.fn();
    const prev = process.env.AI_EXTRACTION_ENABLED;
    process.env.AI_EXTRACTION_ENABLED = "true";
    try {
      for (const path of [name, `cvs/${name}`, `${issued.json.upload_id}/document.pdf`]) {
        const res = await extractForStudent(noRow.id, { submission_id: issued.json.upload_id!, path }, { call });
        expect(res).toMatchObject({ ok: false, code: "invalid_path" });
      }
    } finally {
      process.env.AI_EXTRACTION_ENABLED = prev;
    }
    expect(call).not.toHaveBeenCalled();
    // The extraction code reads the proofs bucket only and never imports the CV modules.
    for (const file of ["src/lib/extraction.ts", "src/app/api/extract/route.ts"]) {
      const src = readFileSync(file, "utf8");
      expect(src, file).not.toMatch(/cv-file|@\/lib\/cv"|student_cvs|cv_files|"cvs"|downloadCvObject|getOwnCv/);
    }
  });
});
