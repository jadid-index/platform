import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { getCurrentUser, requireActiveStudent } from "@/lib/auth";
import { CV_HEADERS } from "@/lib/cv";
import { finalizeCvUpload, removeCvFile } from "@/lib/cv-file";
import { getProfileAccess } from "@/lib/db";
import { cvFileFinalizeBodySchema } from "@/lib/validation";

// The student's uploaded CV (src/lib/cv-file.ts).
// POST   { upload_id, confirm_public? }: step 3, the server downloads and screens the uploaded PDF; a file that
//        fails is deleted. On success it replaces the previous file (whose object is deleted).
//        Returns { file_name, size, uploaded_at }.
// DELETE removes the file (row and storage object). Allowed for a blocked student too: it only removes their data.
export const maxDuration = 30;

export async function POST(request: Request) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const parsed = cvFileFinalizeBodySchema.safeParse(await readJson(request));
    if (!parsed.success) return apiError(400, "invalid_body");
    const done = await finalizeCvUpload(auth.userId, parsed.data);
    if (!done.ok) return apiError(done.status, done.code);
    return NextResponse.json(
      { file_name: done.file_name, size: done.size, uploaded_at: done.uploaded_at },
      { headers: CV_HEADERS },
    );
  } catch (error) {
    console.error("cv file finalize failed", error);
    return apiError(500, "server_error");
  }
}

export async function DELETE() {
  try {
    const user = await getCurrentUser();
    if (!user) return apiError(401, "unauthorized");
    const access = await getProfileAccess(user.id);
    if (access?.role !== "student") return apiError(403, "forbidden");
    const removed = await removeCvFile(user.id);
    if (!removed) return apiError(404, "not_found");
    return NextResponse.json({ ok: true }, { headers: CV_HEADERS });
  } catch (error) {
    console.error("cv file delete failed", error);
    return apiError(500, "server_error");
  }
}
