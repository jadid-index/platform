import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { issueProofUpload } from "@/lib/submissions";
import { uploadUrlBodySchema } from "@/lib/validation";

// Step 1 of adding an achievement: reserve a submission id and return a one-time upload URL for
// proofs/{student_id}/{submission_id}/{file_name} plus a short-lived upload ticket. Limits and checks live in
// issueProofUpload(); the file is checked and hashed in POST /api/submissions.
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

    const issued = await issueProofUpload(auth.userId, parsed.data);
    if (!issued.ok) return apiError(issued.status, issued.code);
    const { submission_id, file_name, upload_url, upload_ticket } = issued;
    return NextResponse.json({ submission_id, file_name, upload_url, upload_ticket });
  } catch (error) {
    console.error("upload-url failed", error);
    return apiError(500, "server_error");
  }
}
