import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { createProofUploadUrl, proofPath } from "@/lib/db";
import { safeFileName, uploadUrlBodySchema } from "@/lib/validation";

// Step 1 of adding an achievement: reserve a submission id and return a one-time upload URL for
// proofs/{student_id}/{submission_id}/{file_name}. The file is checked and hashed in POST /api/submissions.
export async function POST(request: Request) {
  const parsed = uploadUrlBodySchema.safeParse(await readJson(request));
  if (!parsed.success) {
    const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
    if (fields.has("size")) return apiError(400, "file_too_large");
    if (fields.has("content_type")) return apiError(400, "file_type");
    return apiError(400, "invalid_body");
  }

  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const submissionId = randomUUID();
    const fileName = safeFileName(parsed.data.file_name);
    const uploadUrl = await createProofUploadUrl(proofPath(auth.userId, submissionId, fileName));
    return NextResponse.json({ submission_id: submissionId, file_name: fileName, upload_url: uploadUrl });
  } catch (error) {
    console.error("upload-url failed", error);
    return apiError(500, "server_error");
  }
}
