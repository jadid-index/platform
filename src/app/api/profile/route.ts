import { NextResponse } from "next/server";

import { apiError, readJson } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth";
import { createEmployerProfile, createStudentProfile, facultyBelongsToUniversity } from "@/lib/db";
import { profileBodySchema } from "@/lib/validation";

// Creates the signed-in user's profile. Pilot: no email-domain or verification check (CLAUDE.md rule 6).
// Body: { role: "student", full_name, university_id, faculty_id, course, consent_version }
//    or { role: "employer", company_name, contact_person, contact, terms_version }.
// "student" and "employer" are the only roles a person may choose (rule 10); anything else, or any extra key
// (status, verified, ...), is a 400. The role is never read from user metadata. consent_at is set on the server.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return apiError(401, "unauthorized");

  const body = await readJson(request);
  const parsed = profileBodySchema.safeParse(body);
  if (!parsed.success) {
    const consentIssue = parsed.error.issues.some(
      (issue) => issue.path[0] === "consent_version" || issue.path[0] === "terms_version",
    );
    return apiError(400, consentIssue ? "consent_outdated" : "invalid_body");
  }

  try {
    if (parsed.data.role === "employer") {
      const result = await createEmployerProfile(user.id, parsed.data);
      if (!result.ok) return apiError(409, "profile_exists");
      return NextResponse.json({ ok: true, role: "employer" }, { status: 201 });
    }

    const student = parsed.data;
    if (!(await facultyBelongsToUniversity(student.faculty_id, student.university_id))) {
      return apiError(400, "faculty_mismatch");
    }
    const result = await createStudentProfile(user.id, student);
    if (!result.ok) return apiError(409, "profile_exists");
    return NextResponse.json({ ok: true, role: "student" }, { status: 201 });
  } catch (error) {
    console.error("create profile failed", error);
    return apiError(500, "server_error");
  }
}
