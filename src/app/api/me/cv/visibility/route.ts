import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { requireActiveStudent } from "@/lib/auth";
import { CV_HEADERS } from "@/lib/cv";
import { setCvVisibility } from "@/lib/db";
import { CV_ERRORS, cvVisibilityBodySchema } from "@/lib/validation";

// Students only. Body { visibility: "private" | "verified" | "public", confirm?: true, confirm_file?: true }.
// 'public' needs confirm: true (the checkbox in the dialog); set_cv_visibility() stores cv_public_confirmed_at.
// With an uploaded CV file, 'public' also needs confirm_file: true (file_confirmation_required otherwise).
export async function PATCH(request: Request) {
  try {
    const auth = await requireActiveStudent();
    if (!auth.ok) return apiError(auth.status, auth.error);
    const parsed = cvVisibilityBodySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      const confirm = parsed.error.issues.some((i) => i.message === "confirmation_required");
      return apiError(400, confirm ? "confirmation_required" : "invalid_body");
    }
    const outcome = await setCvVisibility(
      auth.userId,
      parsed.data.visibility,
      parsed.data.confirm === true,
      parsed.data.confirm_file === true,
    );
    if (!outcome.ok) return apiError(CV_ERRORS[outcome.code] ?? 400, outcome.code);
    return NextResponse.json(outcome.data, { headers: CV_HEADERS });
  } catch (error) {
    console.error("set cv visibility failed", error);
    return apiError(500, "server_error");
  }
}
