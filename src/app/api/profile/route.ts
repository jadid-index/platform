import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { createStudentProfile, facultyBelongsToUniversity } from "@/lib/db";
import { profileBodySchema } from "@/lib/validation";

// Creates the signed-in user's student profile. Pilot: no email-domain or verification check (CLAUDE.md rule 6).
// Body: { full_name, university_id, faculty_id, course, consent_version }.
// consent_at is set here; role and status are never taken from the body.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized");

  const body = await readJson(request);
  const parsed = profileBodySchema.safeParse(body);
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some((issue) => issue.path[0] === "consent_version");
    return apiError(400, consentIssue ? "consent_outdated" : "invalid_body");
  }

  try {
    if (!(await facultyBelongsToUniversity(parsed.data.faculty_id, parsed.data.university_id))) {
      return apiError(400, "faculty_mismatch");
    }

    const result = await createStudentProfile(user.id, parsed.data);
    if (!result.ok) {
      return apiError(409, "profile_exists");
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    console.error("create profile failed", error);
    return apiError(500, "server_error");
  }
}
