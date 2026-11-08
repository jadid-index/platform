import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { CV_HEADERS } from "@/lib/cv";
import { getOwnCv, saveCv } from "@/lib/db";
import { CV_ERRORS, cvBodySchema } from "@/lib/validation";

// Students only (rule 10). The owner's CV: the editable document, its visibility and the full preview.
export async function GET() {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const cv = await getOwnCv(auth.userId);
    if (!cv) return apiError(403, "profile_not_active");
    return NextResponse.json(cv, { headers: CV_HEADERS });
  } catch (error) {
    console.error("get own cv failed", error);
    return apiError(500, "server_error");
  }
}

// Body: the whole CV (strict, see cvBodySchema). The visibility is changed on /api/me/cv/visibility.
// save_cv() checks the limits again and allows 60 writes an hour.
export async function PUT(request: Request) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const body = cvBodySchema.safeParse(await readJson(request));
    if (!body.success) return apiError(400, "invalid_body");
    const outcome = await saveCv(auth.userId, body.data);
    if (!outcome.ok) return apiError(CV_ERRORS[outcome.code] ?? 400, outcome.code);
    return NextResponse.json({ updated_at: outcome.data }, { headers: CV_HEADERS });
  } catch (error) {
    console.error("save cv failed", error);
    return apiError(500, "server_error");
  }
}
