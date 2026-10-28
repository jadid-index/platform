import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { listOwnSubmissions } from "@/lib/db";
import { createSubmissionFromUpload } from "@/lib/submissions";
import { submissionBodySchema } from "@/lib/validation";

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

// POST: step 3 of adding an achievement. The proof is already in storage (see ./upload-url).
// Validation follows SPEC.md section 2 and lives in createSubmissionFromUpload().
export async function POST(request: Request) {
  const parsed = submissionBodySchema.safeParse(await readJson(request));
  if (!parsed.success) return apiError(400, "invalid_body");

  try {
    // 1. Profile must be an active student. The student id always comes from the session.
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);

    const created = await createSubmissionFromUpload(auth.userId, parsed.data);
    if (!created.ok) return apiError(created.status, created.code);
    return NextResponse.json({ id: created.id, status: "pending" }, { status: 201 });
  } catch (error) {
    console.error("create submission failed", error);
    return apiError(500, "server_error");
  }
}
