import "server-only";

import { randomUUID } from "node:crypto";

import {
  createCvUploadUrl,
  cvObjectName,
  deleteCvObjects,
  downloadCvObject,
  finalizeCvFile,
  forgetCvFile,
  getCurrentCvFile,
  getCvVisibility,
  getPendingCvFile,
  issueCvFile,
  rejectCvFile,
  removeCvFileRow,
  staleCvFiles,
} from "@/lib/db";
import { screenPdf } from "@/lib/pdf-screen";
import type { OwnCvFile } from "@/lib/types";
import { CV_ERRORS, cvDisplayFileName, type CvFileFinalizeBody, type CvFileUploadUrlBody } from "@/lib/validation";

// The uploaded CV (a PDF the student made elsewhere), next to the typed CV. Same cv_visibility, same access matrix
// (cvAccess()). Three steps, like proofs, because Vercel limits request bodies to 4.5 MB:
//   1. issueCvUpload(): checks the student and the declared type and size, reserves cvs/{student_id}/{random}.pdf,
//      returns a one-time upload URL (the object name never appears in a response field);
//   2. the browser uploads straight to the private bucket;
//   3. finalizeCvUpload(): downloads the object and screens it (src/lib/pdf-screen.ts, not a malware scanner).
//      A failed check deletes the object. Success replaces the previous file and deletes its object.
// Unfinished uploads are removed by cleanupCvUploads() (admin button or `npm run cleanup:cv-uploads`).
// The file is never sent to the AI model: /api/extract only reads the proofs bucket.

export const CV_FILE_URL_SECONDS = 60;
export const CV_FILE_REQUESTS_PER_WINDOW = 30;
export const CV_FILE_WINDOW_MINUTES = 10;
export const CV_UPLOAD_STALE_MINUTES = 60;

export type CvFileFailure = { ok: false; status: number; code: string };

const fail = (code: string, status = CV_ERRORS[code] ?? 400): CvFileFailure => ({ ok: false, status, code });

// What the owner sees about their file: never the object name.
export async function getOwnCvFile(studentId: string): Promise<OwnCvFile | null> {
  const f = await getCurrentCvFile(studentId);
  return f ? { file_name: f.file_name, size: f.size, uploaded_at: f.uploaded_at } : null;
}

// Uploading while the CV is public needs the extra confirmation up front (checked again in step 3, in SQL).
async function needsPublicConfirmation(studentId: string, confirmPublic: boolean): Promise<boolean> {
  return !confirmPublic && (await getCvVisibility(studentId)) === "public";
}

export async function issueCvUpload(
  studentId: string,
  body: CvFileUploadUrlBody,
): Promise<{ ok: true; upload_id: string; upload_url: string } | CvFileFailure> {
  if (await needsPublicConfirmation(studentId, body.confirm_public === true)) return fail("file_confirmation_required");
  const id = randomUUID();
  const issued = await issueCvFile(studentId, id, cvDisplayFileName(body.file_name));
  if (!issued.ok) return fail(issued.code);
  const uploadUrl = await createCvUploadUrl(cvObjectName(studentId, id));
  return { ok: true, upload_id: id, upload_url: uploadUrl };
}

// Deletes objects and then their rows (the rows stay until the upload URL has expired; see cv_file_forget()).
async function deleteAndForget(items: { id: string; object_name: string }[]): Promise<number> {
  if (items.length === 0) return 0;
  if (!(await deleteCvObjects(items.map((i) => i.object_name)))) return 0;
  for (const i of items) await forgetCvFile(i.id);
  return items.length;
}

export async function finalizeCvUpload(
  studentId: string,
  body: CvFileFinalizeBody,
): Promise<({ ok: true } & OwnCvFile) | CvFileFailure> {
  // Only this student's own pending upload. Anything else is refused before a single object is touched.
  const pending = await getPendingCvFile(studentId, body.upload_id);
  if (!pending) return fail("invalid_upload");

  const reject = async (code: string): Promise<CvFileFailure> => {
    await rejectCvFile(studentId, pending.id);
    await deleteAndForget([pending]);
    return fail(code);
  };

  if (Date.now() - new Date(pending.created_at).getTime() > CV_UPLOAD_STALE_MINUTES * 60_000) return reject("upload_expired");
  const blob = await downloadCvObject(pending.object_name);
  if (!blob) return fail("file_missing");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const screened = screenPdf(bytes);
  if (!screened.ok) return reject(screened.code);

  const done = await finalizeCvFile(studentId, pending.id, bytes.length, body.confirm_public === true);
  if (!done.ok) {
    // Not confirmed yet while the CV is public: keep the upload so the student can confirm and retry.
    if (done.code === "file_confirmation_required") return fail(done.code);
    return reject(done.code);
  }
  const { old_id, old_object, ...info } = done.data;
  if (old_id && old_object) await deleteAndForget([{ id: old_id, object_name: old_object }]);
  return { ok: true, ...info };
}

// The student deletes the uploaded CV: the row first (so nobody is served it any more), then the object.
export async function removeCvFile(studentId: string): Promise<boolean> {
  const removed = await removeCvFileRow(studentId);
  if (!removed) return false;
  await deleteAndForget([{ id: removed.id, object_name: removed.object }]);
  return true;
}

// Removes CV objects that are not some student's current file: uploads never finalized within the hour, files
// whose delete failed earlier, and files of deleted accounts. Safe to run any time and repeatedly.
export async function cleanupCvUploads(olderThanMinutes = CV_UPLOAD_STALE_MINUTES): Promise<number> {
  let total = 0;
  for (let round = 0; round < 20; round++) {
    const batch = await staleCvFiles(olderThanMinutes, 500);
    if (batch.length === 0) break;
    if (!(await deleteCvObjects(batch.map((b) => b.object_name)))) break;
    for (const b of batch) await forgetCvFile(b.id);
    total += batch.length;
    if (batch.length < 500) break;
  }
  return total;
}
