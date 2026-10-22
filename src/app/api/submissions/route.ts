import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import {
  deleteProof,
  downloadProof,
  getAchievementType,
  getCountFrom,
  insertSubmission,
  isLiveFile,
  isOwnRejectedSubmission,
  listOwnSubmissions,
  proofPath,
  rubricCombinationExists,
  submissionExists,
} from "@/lib/db";
import {
  JOURNAL_ARTICLE_TYPE_NAME,
  PROOF_MAX_BYTES,
  safeFileName,
  submissionBodySchema,
  todayInTashkent,
} from "@/lib/validation";

// GET: the signed-in student's own submissions, newest first, with status and rejection reason.
export async function GET() {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    return NextResponse.json({ submissions: await listOwnSubmissions(auth.userId) });
  } catch (error) {
    console.error("list submissions failed", error);
    return apiError(500, "server_error");
  }
}

// POST: step 2 of adding an achievement. The proof is already in storage (see ./upload-url).
// Validation follows SPEC.md section 2.
export async function POST(request: Request) {
  const parsed = submissionBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_body");
  const body = parsed.data;

  // 1. Profile must be an active student.
  let auth: Awaited<ReturnType<typeof requireActiveStudent>>;
  try {
    auth = await requireActiveStudent();
  } catch (error) {
    console.error("auth check failed", error);
    return apiError(500, "server_error");
  }
  if (!auth.ok) return apiError(auth.status, auth.error);

  const path = proofPath(auth.userId, body.submission_id, safeFileName(body.file_name));
  // Any rejection below removes the uploaded file, so nothing unreferenced stays in the bucket.
  const reject = async (status: number, code: string) => {
    await deleteProof(path);
    return apiError(status, code);
  };

  try {
    // An id that already belongs to a submission must never reach reject(), which would delete its file.
    if (await submissionExists(body.submission_id)) return apiError(409, "invalid_body");

    // 3. The combination must exist in rubric_points. Types without placement are always "confirmed".
    const type = await getAchievementType(body.type_id);
    if (!type) return reject(400, "invalid_type");
    const result = type.has_placement ? body.result : "confirmed";
    if (!result || !(await rubricCombinationExists(type.id, body.level, result))) {
      return reject(400, "invalid_combination");
    }

    // 4. Date: not in the future, not before count_from.
    if (body.achievement_date > todayInTashkent()) return reject(400, "date_in_future");
    if (body.achievement_date < (await getCountFrom())) return reject(400, "date_too_early");

    // 5. Certificate reference is required for journal articles.
    if (type.name === JOURNAL_ARTICLE_TYPE_NAME && !body.certificate_ref) {
      return reject(400, "certificate_ref_required");
    }

    // 7. A resubmission must point to the student's own rejected submission.
    if (body.parent_id && !(await isOwnRejectedSubmission(body.parent_id, auth.userId))) {
      return reject(400, "invalid_parent");
    }

    // 2. File: PDF, JPG or PNG, 10 MB or less, checked on the stored bytes. SHA-256 computed here.
    const file = await downloadProof(path);
    if (!file) return apiError(400, "file_missing");
    if (file.size > PROOF_MAX_BYTES) return reject(400, "file_too_large");
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!looksLikeProof(bytes)) return reject(400, "file_type");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    if (await isLiveFile(sha256)) return reject(409, "duplicate_file");

    const inserted = await insertSubmission({
      id: body.submission_id,
      student_id: auth.userId,
      type_id: type.id,
      level: body.level,
      result,
      title: body.title,
      issuer: body.issuer,
      achievement_date: body.achievement_date,
      certificate_ref: body.certificate_ref,
      note: body.note,
      file_path: path,
      file_sha256: sha256,
      parent_id: body.parent_id ?? null,
      student_comment: body.parent_id ? body.student_comment : null,
    });
    if (!inserted.ok) {
      // The unique index can still catch a duplicate that raced the check above.
      if (inserted.reason === "duplicate_file") return reject(409, "duplicate_file");
      // The id was taken between the check above and the insert: leave that submission's file alone.
      return apiError(409, "invalid_body");
    }

    return NextResponse.json({ id: body.submission_id, status: "pending" }, { status: 201 });
  } catch (error) {
    console.error("create submission failed", error);
    return apiError(500, "server_error");
  }
}

// Checks the file signature instead of trusting the declared content type.
function looksLikeProof(b: Uint8Array): boolean {
  const pdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
  const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47; // .PNG
  const jpg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  return pdf || png || jpg;
}
