import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { CV_HEADERS } from "@/lib/cv";
import { issueCvUpload } from "@/lib/cv-file";
import { cvFileUploadUrlBodySchema } from "@/lib/validation";

// Step 1 of the uploaded CV (students only). Body { file_name, size, content_type: "application/pdf",
// confirm_public? }. Returns { upload_id, upload_url }: a one-time URL to upload straight to the private 'cvs'
// bucket (request bodies over 4.5 MB never pass through Vercel). The object name is not returned as a field.
export async function POST(request: Request) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const parsed = cvFileUploadUrlBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const fields = new Set(parsed.error.issues.map((i) => i.path[0]));
      if (fields.has("size")) return apiError(400, "file_too_large");
      if (fields.has("content_type") || fields.has("file_name")) return apiError(400, "file_type");
      return apiError(400, "invalid_body");
    }
    const issued = await issueCvUpload(auth.userId, parsed.data);
    if (!issued.ok) return apiError(issued.status, issued.code);
    return NextResponse.json({ upload_id: issued.upload_id, upload_url: issued.upload_url }, { headers: CV_HEADERS });
  } catch (error) {
    console.error("cv upload-url failed", error);
    return apiError(500, "server_error");
  }
}
