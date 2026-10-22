import "server-only";

import { getAdminClient } from "@/lib/supabase/admin";
import type {
  AchievementType,
  Meta,
  OwnSubmission,
  PointsPreview,
  ReviewQueueItem,
  RubricRow,
  SubmissionForReview,
  University,
} from "@/lib/types";
import type { Level, ProfileBody, Result } from "@/lib/validation";

// The one server-side module that talks to the database and storage. Route handlers and server components
// call these functions; nothing else imports the admin client.

export async function listUniversitiesWithFaculties(): Promise<University[]> {
  const { data, error } = await getAdminClient()
    .from("universities")
    .select("id, name, faculties(id, name)")
    .order("name")
    .order("name", { referencedTable: "faculties" });
  if (error) throw error;
  return data ?? [];
}

export async function isEmailDomainAllowed(domain: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("allowed_email_domains")
    .select("domain")
    .eq("domain", domain.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function facultyBelongsToUniversity(facultyId: number, universityId: number): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("faculties")
    .select("id")
    .eq("id", facultyId)
    .eq("university_id", universityId)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export type ProfileSummary = {
  id: string;
  full_name: string;
  course: number | null;
  role: "student" | "reviewer" | "admin";
  university: string;
  faculty: string | null;
};

export async function getProfileSummary(userId: string): Promise<ProfileSummary | null> {
  const { data, error } = await getAdminClient()
    .from("profiles")
    .select("id, full_name, course, role, universities(name), faculties(name)")
    .eq("id", userId)
    .maybeSingle<{
      id: string;
      full_name: string;
      course: number | null;
      role: ProfileSummary["role"];
      universities: { name: string } | null;
      faculties: { name: string } | null;
    }>();
  if (error) throw error;
  if (!data) return null;
  return {
    id: data.id,
    full_name: data.full_name,
    course: data.course,
    role: data.role,
    university: data.universities?.name ?? "",
    faculty: data.faculties?.name ?? null,
  };
}

export type CreateProfileResult =
  | { ok: true }
  | { ok: false; reason: "exists" | "email_not_verified" | "domain_not_allowed" };

// Creates a student profile. The enforce_student_email trigger makes the final domain and verification check.
export async function createStudentProfile(userId: string, body: ProfileBody): Promise<CreateProfileResult> {
  const { error } = await getAdminClient().from("profiles").insert({
    id: userId,
    full_name: body.full_name,
    university_id: body.university_id,
    faculty_id: body.faculty_id,
    course: body.course,
    consent_version: body.consent_version,
    consent_at: new Date().toISOString(),
    status: "active",
  });
  if (!error) return { ok: true };
  if (error.code === "23505") return { ok: false, reason: "exists" };
  if (error.message.includes("email is not verified")) return { ok: false, reason: "email_not_verified" };
  if (error.message.includes("email domain is not allowed")) return { ok: false, reason: "domain_not_allowed" };
  throw error;
}

// ------------------------------------------------------------------ meta

export async function getMeta(): Promise<Meta> {
  const db = getAdminClient();
  const [universities, types, rubric, countFrom] = await Promise.all([
    listUniversitiesWithFaculties(),
    db
      .from("achievement_types")
      .select("id, category_code, name, base_points, has_placement, proof_hint")
      .order("id"),
    db.from("rubric_points").select("type_id, level, result, points").order("type_id").order("points"),
    getCountFrom(),
  ]);
  if (types.error) throw types.error;
  if (rubric.error) throw rubric.error;
  return {
    universities,
    achievement_types: (types.data ?? []) as AchievementType[],
    rubric_points: (rubric.data ?? []) as RubricRow[],
    count_from: countFrom,
  };
}

export async function getCountFrom(): Promise<string> {
  const { data, error } = await getAdminClient()
    .from("app_settings")
    .select("value")
    .eq("key", "count_from")
    .single();
  if (error) throw error;
  return data.value as string;
}

// ------------------------------------------------------------ submissions

export async function getProfileAccess(
  userId: string,
): Promise<{ role: ProfileSummary["role"]; status: "pending" | "active" | "rejected" } | null> {
  const { data, error } = await getAdminClient()
    .from("profiles")
    .select("role, status")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAchievementType(typeId: number): Promise<AchievementType | null> {
  const { data, error } = await getAdminClient()
    .from("achievement_types")
    .select("id, category_code, name, base_points, has_placement, proof_hint")
    .eq("id", typeId)
    .maybeSingle();
  if (error) throw error;
  return data as AchievementType | null;
}

export async function rubricCombinationExists(typeId: number, level: Level, result: Result): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("rubric_points")
    .select("id")
    .eq("type_id", typeId)
    .eq("level", level)
    .eq("result", result)
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function isOwnRejectedSubmission(submissionId: string, studentId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("submissions")
    .select("id")
    .eq("id", submissionId)
    .eq("student_id", studentId)
    .eq("status", "rejected")
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export async function submissionExists(submissionId: string): Promise<boolean> {
  const { data, error } = await getAdminClient().from("submissions").select("id").eq("id", submissionId).maybeSingle();
  if (error) throw error;
  return data !== null;
}

// A "live" file is one on a pending or approved submission (same rule as submissions_live_file_uq).
export async function isLiveFile(sha256: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("submissions")
    .select("id")
    .eq("file_sha256", sha256)
    .in("status", ["pending", "approved"])
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

export type NewSubmission = {
  id: string;
  student_id: string;
  type_id: number;
  level: Level;
  result: Result;
  title: string;
  issuer: string;
  achievement_date: string;
  certificate_ref: string | null;
  note: string | null;
  file_path: string;
  file_sha256: string;
  parent_id: string | null;
  student_comment: string | null;
};

export async function insertSubmission(
  row: NewSubmission,
): Promise<{ ok: true } | { ok: false; reason: "duplicate_file" | "id_taken" }> {
  const { error } = await getAdminClient().from("submissions").insert({ ...row, status: "pending" });
  if (!error) return { ok: true };
  if (error.code === "23505") {
    return { ok: false, reason: error.message.includes("submissions_live_file_uq") ? "duplicate_file" : "id_taken" };
  }
  throw error;
}

export async function listOwnSubmissions(studentId: string): Promise<OwnSubmission[]> {
  const db = getAdminClient();
  const [subs, types] = await Promise.all([
    db
      .from("submissions")
      .select(
        "id, title, type_id, level, result, achievement_date, status, submitted_at, reviews(points_awarded, rejection_reason)",
      )
      .eq("student_id", studentId)
      .order("submitted_at", { ascending: false }),
    db.from("achievement_types").select("id, name"),
  ]);
  if (subs.error) throw subs.error;
  if (types.error) throw types.error;

  const typeNames = new Map((types.data ?? []).map((t) => [t.id as number, t.name as string]));
  return (subs.data ?? []).map((s) => {
    // reviews.submission_id is unique, so PostgREST may return an object or a one-element array.
    const review = (Array.isArray(s.reviews) ? s.reviews[0] : s.reviews) as
      | { points_awarded: number | null; rejection_reason: string | null }
      | undefined
      | null;
    return {
      id: s.id,
      title: s.title,
      type_id: s.type_id,
      type_name: typeNames.get(s.type_id) ?? "",
      level: s.level,
      result: s.result,
      achievement_date: s.achievement_date,
      status: s.status,
      submitted_at: s.submitted_at,
      points_awarded: review?.points_awarded ?? null,
      rejection_reason: review?.rejection_reason ?? null,
    };
  });
}

// All-time total, read from the leaderboard view (sum of points_awarded on approved reviews).
export async function getTotalPoints(studentId: string): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("leaderboard")
    .select("total_points")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  return data?.total_points ?? 0;
}

// Withdraws the student's own pending submission. Returns false if there is no such submission.
// Withdrawn submissions drop out of submissions_live_file_uq, so the same file can be submitted again.
export async function withdrawOwnSubmission(submissionId: string, studentId: string): Promise<boolean> {
  const { data, error } = await getAdminClient()
    .from("submissions")
    .update({ status: "withdrawn" })
    .eq("id", submissionId)
    .eq("student_id", studentId)
    .eq("status", "pending")
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------- review

async function typeNames(): Promise<Map<number, string>> {
  const { data, error } = await getAdminClient().from("achievement_types").select("id, name");
  if (error) throw error;
  return new Map((data ?? []).map((t) => [t.id as number, t.name as string]));
}

type StudentEmbed = { id: string; full_name: string; course: number | null; faculties: { name: string } | null };

// Pending submissions, oldest first.
export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  const [subs, names] = await Promise.all([
    getAdminClient()
      .from("submissions")
      .select("id, title, type_id, level, result, submitted_at, profiles(id, full_name, course, faculties(name))")
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
    typeNames(),
  ]);
  if (subs.error) throw subs.error;
  return (subs.data ?? []).map((s) => {
    const student = s.profiles as unknown as StudentEmbed | null;
    return {
      id: s.id,
      title: s.title,
      type_id: s.type_id,
      type_name: names.get(s.type_id) ?? "",
      level: s.level,
      result: s.result,
      submitted_at: s.submitted_at,
      student_name: student?.full_name ?? "",
      faculty: student?.faculties?.name ?? null,
    };
  });
}

export async function getSubmissionForReview(submissionId: string): Promise<SubmissionForReview | null> {
  const { data, error } = await getAdminClient()
    .from("submissions")
    .select(
      "id, status, type_id, level, result, title, issuer, achievement_date, certificate_ref, note, student_comment, parent_id, submitted_at, file_path, profiles(id, full_name, course, faculties(name))",
    )
    .eq("id", submissionId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const { profiles, ...rest } = data;
  const student = profiles as unknown as StudentEmbed;
  return {
    ...(rest as Omit<SubmissionForReview, "student">),
    student: {
      id: student.id,
      full_name: student.full_name,
      faculty: student.faculties?.name ?? null,
      course: student.course,
    },
  };
}

// Mirrors the cap arithmetic in approve_submission() for display only; nothing here is stored.
// approve_submission() recomputes everything under a lock when the reviewer approves.
export async function getPointsPreview(
  submissionId: string,
  typeId: number,
  level: Level,
  result: Result,
): Promise<PointsPreview | null> {
  const db = getAdminClient();
  const { data: sub, error: subError } = await db
    .from("submissions")
    .select("student_id, achievement_date")
    .eq("id", submissionId)
    .maybeSingle();
  if (subError) throw subError;
  if (!sub) return null;

  const [type, rubric, year] = await Promise.all([
    db.from("achievement_types").select("category_code, categories(yearly_cap)").eq("id", typeId).maybeSingle(),
    db
      .from("rubric_points")
      .select("points")
      .eq("type_id", typeId)
      .eq("level", level)
      .eq("result", result)
      .maybeSingle(),
    db.rpc("academic_year", { d: sub.achievement_date }),
  ]);
  if (type.error) throw type.error;
  if (rubric.error) throw rubric.error;
  if (year.error) throw year.error;
  if (!type.data) return null;

  const categoryCode = type.data.category_code as string;
  const cap = (type.data.categories as unknown as { yearly_cap: number }).yearly_cap;
  const academicYear = year.data as number;

  const { data: approved, error: usedError } = await db
    .from("reviews")
    .select("points_awarded")
    .eq("student_id", sub.student_id)
    .eq("decision", "approved")
    .eq("category_code", categoryCode)
    .eq("academic_year", academicYear);
  if (usedError) throw usedError;
  const used = (approved ?? []).reduce((sum, r) => sum + (r.points_awarded ?? 0), 0);

  const rubricPoints = (rubric.data?.points as number | undefined) ?? null;
  return {
    rubric_points: rubricPoints,
    category_code: categoryCode,
    academic_year: academicYear,
    used,
    cap,
    awarded: rubricPoints === null ? 0 : Math.max(0, Math.min(rubricPoints, cap - used)),
  };
}

export type ReviewOutcome = { ok: true } | { ok: false; message: string };
export type ApproveOutcome =
  | { ok: true; rubric_points: number; points_awarded: number }
  | { ok: false; message: string };

// Both functions run the SQL functions, which enforce every rule (pending only, active reviewer,
// no self-review, counting start date, valid combination, yearly cap, reason required).
// A raised exception comes back as { ok: false, message } with the SQL message.
// approve_submission() returns the new reviews row, which carries points_awarded after the cap.
export async function approveSubmission(
  submissionId: string,
  reviewerId: string,
  typeId: number,
  level: Level,
  result: Result,
): Promise<ApproveOutcome> {
  const { data, error } = await getAdminClient().rpc("approve_submission", {
    p_submission: submissionId,
    p_reviewer: reviewerId,
    p_type: typeId,
    p_level: level,
    p_result: result,
  });
  if (!error) {
    const review = data as { rubric_points: number; points_awarded: number };
    return { ok: true, rubric_points: review.rubric_points, points_awarded: review.points_awarded };
  }
  if (error.code === "P0001") return { ok: false, message: error.message };
  throw error;
}

export async function rejectSubmission(submissionId: string, reviewerId: string, reason: string): Promise<ReviewOutcome> {
  const { error } = await getAdminClient().rpc("reject_submission", {
    p_submission: submissionId,
    p_reviewer: reviewerId,
    p_reason: reason,
  });
  if (!error) return { ok: true };
  if (error.code === "P0001") return { ok: false, message: error.message };
  throw error;
}

// ---------------------------------------------------------------- storage

const PROOFS_BUCKET = "proofs";

export function proofPath(studentId: string, submissionId: string, fileName: string): string {
  return `${studentId}/${submissionId}/${fileName}`;
}

// One-time URL the browser uses to upload the proof straight to the private bucket. Large files would
// exceed the serverless request body limit if they went through a route handler.
export async function createProofUploadUrl(path: string): Promise<string> {
  const { data, error } = await getAdminClient().storage.from(PROOFS_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadProof(path: string): Promise<Blob | null> {
  const { data, error } = await getAdminClient().storage.from(PROOFS_BUCKET).download(path);
  if (error) {
    if ("status" in error && (error.status === 400 || error.status === 404)) return null;
    throw error;
  }
  return data;
}

// Short-lived read URL for reviewers. Never use it on public pages.
export async function createProofReadUrl(path: string, expiresInSeconds: number): Promise<string> {
  const { data, error } = await getAdminClient().storage.from(PROOFS_BUCKET).createSignedUrl(path, expiresInSeconds);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteProof(path: string): Promise<void> {
  const { error } = await getAdminClient().storage.from(PROOFS_BUCKET).remove([path]);
  if (error) console.error("delete proof failed", path, error);
}
