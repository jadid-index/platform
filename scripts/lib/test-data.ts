// Test-data helpers for scripts/seed-demo.ts and the tests. Everything created here is marked as test data:
// emails test-...@example.invalid (".invalid" can never receive mail), names starting with "TEST", titles
// starting with "[TEST]". cleanTestData() removes it again.
//
// App code reaches the database only through src/lib/db.ts. This file is tooling: it uses db.ts and
// submissions.ts for everything the app also does, and the admin client only for setup the app has no
// function for (creating auth users and reviewers, uploading as the browser would, deleting test rows).

import { createHash, randomBytes } from "node:crypto";

import { CONSENT_VERSION } from "@/lib/consent";
import { createStudentProfile, getMeta, listUniversitiesWithFaculties } from "@/lib/db";
import { getAdminClient } from "@/lib/supabase/admin";
import { createSubmissionFromUpload, issueProofUpload } from "@/lib/submissions";
import type { Meta } from "@/lib/types";
import type { Level, Result, SubmissionBody } from "@/lib/validation";

export const TEST_EMAIL_DOMAIN = "example.invalid";
const TEST_EMAIL = /^test-[a-z0-9-]+@example\.invalid$/;

export const isTestEmail = (email: string | undefined) => !!email && TEST_EMAIL.test(email);

export function testEmail(local: string): string {
  const email = `test-${local}@${TEST_EMAIL_DOMAIN}`;
  if (!isTestEmail(email)) throw new Error(`not a test email: ${email}`);
  return email;
}

// ------------------------------------------------------------------ users

export type TestUser = { id: string; email: string; password: string };

// email_confirm stays false by default: pilot sign-up needs no verification (CLAUDE.md rule 6).
export async function createTestAuthUser(local: string, opts: { confirmed?: boolean } = {}): Promise<TestUser> {
  const email = testEmail(local);
  const password = `Test-${randomBytes(9).toString("base64url")}`;
  const { data, error } = await getAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: opts.confirmed ?? false,
  });
  if (error) throw error;
  return { id: data.user.id, email, password };
}

async function pilotFaculty(): Promise<{ university_id: number; faculty_id: number }> {
  const universities = await listUniversitiesWithFaculties();
  const university = universities.find((u) => u.faculties.length > 0);
  if (!university) throw new Error("no university with faculties in the database");
  return { university_id: university.id, faculty_id: university.faculties[0].id };
}

// Same code path as POST /api/profile.
// confirmed: true when the test signs in with the password (an admin-created unconfirmed user cannot;
// real sign-ups are confirmed automatically while "Confirm email" is off).
export async function createTestStudent(
  local: string,
  fullName: string,
  course = 2,
  opts: { confirmed?: boolean } = {},
): Promise<TestUser> {
  const user = await createTestAuthUser(local, opts);
  const result = await createStudentProfile(user.id, {
    full_name: `TEST ${fullName}`,
    ...(await pilotFaculty()),
    course,
    consent_version: CONSENT_VERSION,
  });
  if (!result.ok) throw new Error(`createStudentProfile failed: ${result.reason}`);
  return user;
}

// Reviewer accounts are created by hand in the database for now (CLAUDE.md open items); this does the same.
export async function createTestReviewer(local: string, fullName: string): Promise<TestUser> {
  const user = await createTestAuthUser(local, { confirmed: true });
  const { university_id } = await pilotFaculty();
  const { error } = await getAdminClient()
    .from("profiles")
    .insert({ id: user.id, full_name: `TEST ${fullName}`, university_id, role: "reviewer", status: "active" });
  if (error) throw error;
  return user;
}

export async function setProfileStatus(userId: string, status: "active" | "pending" | "rejected"): Promise<void> {
  const { error } = await getAdminClient().from("profiles").update({ status }).eq("id", userId);
  if (error) throw error;
}

// ------------------------------------------------------------------ files

// A minimal one-page PDF. The label makes every file unique, so the SHA-256 duplicate check does not fire.
export function samplePdf(label: string): Uint8Array {
  const text = `[TEST] ${label}`.replace(/[()\\]/g, "");
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

export const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Step 2 as the browser does it, but with the secret key: put the bytes at the path upload-url issued.
export async function uploadProofBytes(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const { error } = await getAdminClient()
    .storage.from("proofs")
    .upload(path, bytes, { contentType, upsert: false });
  if (error) throw error;
}

export async function proofExists(path: string): Promise<boolean> {
  const { data, error } = await getAdminClient().storage.from("proofs").download(path);
  if (error) return false;
  return data.size > 0;
}

// ------------------------------------------------------------ submissions

export type SubmissionFields = Omit<SubmissionBody, "submission_id" | "file_name" | "upload_ticket">;

// All three steps through the same functions the API routes use: issueProofUpload (upload-url),
// a direct upload of the bytes, then createSubmissionFromUpload (POST /api/submissions).
export async function submitThroughApiPath(
  studentId: string,
  fields: SubmissionFields,
  file: { bytes: Uint8Array; name: string; contentType: "application/pdf" | "image/jpeg" | "image/png" },
) {
  const issued = await issueProofUpload(studentId, {
    file_name: file.name,
    size: file.bytes.length,
    content_type: file.contentType,
  });
  if (!issued.ok) return { issued, created: null, path: null };
  const path = `${studentId}/${issued.submission_id}/${issued.file_name}`;
  await uploadProofBytes(path, file.bytes, file.contentType);
  const created = await createSubmissionFromUpload(studentId, {
    ...fields,
    submission_id: issued.submission_id,
    file_name: issued.file_name,
    upload_ticket: issued.upload_ticket,
  });
  return { issued, created, path };
}

export function fields(
  over: Partial<SubmissionFields> & Pick<SubmissionFields, "type_id" | "level" | "achievement_date">,
): SubmissionFields {
  return {
    title: "[TEST] Sinov yutugʻi",
    issuer: "TEST tashkilot",
    certificate_ref: "TEST-REF",
    note: null,
    student_comment: null,
    ...over,
  };
}

// A pending row inserted directly (no file), for tests that only need the review side or a count.
export async function insertPendingRow(
  studentId: string,
  row: { type_id: number; level: Level; result: Result; achievement_date: string; title?: string },
): Promise<string> {
  const id = crypto.randomUUID();
  const { error } = await getAdminClient()
    .from("submissions")
    .insert({
      id,
      student_id: studentId,
      ...row,
      title: row.title ?? "[TEST] Toʻgʻridan-toʻgʻri qator",
      issuer: "TEST tashkilot",
      file_path: `${studentId}/${id}/none.pdf`,
      file_sha256: createHash("sha256").update(id).digest("hex"),
      status: "pending",
    });
  if (error) throw error;
  return id;
}

export async function insertAuditRows(actorId: string, action: string, count: number): Promise<void> {
  const rows = Array.from({ length: count }, (_, i) => ({ actor_id: actorId, action, entity: "test", entity_id: String(i) }));
  const { error } = await getAdminClient().from("audit_log").insert(rows);
  if (error) throw error;
}

// ---------------------------------------------------------------- rubric

export type RubricChoice = { type_id: number; type_name: string; category_code: string; level: Level; result: Result; points: number };

export async function rubricChoices(): Promise<{ meta: Meta; rows: RubricChoice[] }> {
  const meta = await getMeta();
  const types = new Map(meta.achievement_types.map((t) => [t.id, t]));
  const rows = meta.rubric_points.map((r) => {
    const type = types.get(r.type_id)!;
    return { type_id: r.type_id, type_name: type.name, category_code: type.category_code, level: r.level, result: r.result, points: r.points };
  });
  return { meta, rows };
}

// ---------------------------------------------------------------- cleanup

// Removes every test user (or only those whose email starts with test-<prefix>), their files and rows.
// Order matters: reviews and audit_log reference profiles without ON DELETE CASCADE.
export async function cleanTestData(prefix?: string): Promise<number> {
  const db = getAdminClient();
  const users: { id: string; email: string }[] = [];
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const u of data.users) {
      if (!isTestEmail(u.email)) continue;
      if (prefix && !u.email!.startsWith(`test-${prefix}`)) continue;
      users.push({ id: u.id, email: u.email! });
    }
    if (data.users.length < 1000) break;
  }
  if (users.length === 0) return 0;
  const ids = users.map((u) => u.id);

  for (const id of ids) {
    const { data: folders } = await db.storage.from("proofs").list(id, { limit: 1000 });
    const paths: string[] = [];
    for (const folder of folders ?? []) {
      const { data: files } = await db.storage.from("proofs").list(`${id}/${folder.name}`, { limit: 100 });
      for (const f of files ?? []) paths.push(`${id}/${folder.name}/${f.name}`);
    }
    if (paths.length) await db.storage.from("proofs").remove(paths);
  }

  const { data: subs, error: subsError } = await db.from("submissions").select("id").in("student_id", ids);
  if (subsError) throw subsError;
  const subIds = (subs ?? []).map((s) => s.id as string);

  const steps = [
    db.from("audit_log").delete().in("actor_id", ids),
    ...(subIds.length ? [db.from("audit_log").delete().in("entity_id", subIds)] : []),
  ];
  for (const step of steps) {
    const { error } = await step;
    if (error) throw error;
  }
  for (const column of ["student_id", "reviewer_id"]) {
    const { error } = await db.from("reviews").delete().in(column, ids);
    if (error) throw error;
  }
  // Resubmissions point at their parent, so clear the links before deleting.
  if (subIds.length) {
    const { error: unlink } = await db.from("submissions").update({ parent_id: null }).in("id", subIds);
    if (unlink) throw unlink;
    const { error } = await db.from("submissions").delete().in("id", subIds);
    if (error) throw error;
  }
  for (const id of ids) {
    const { error } = await db.auth.admin.deleteUser(id); // cascades to profiles
    if (error) throw error;
  }
  return users.length;
}
