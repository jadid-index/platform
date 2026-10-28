import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { getAdminClient } from "@/lib/supabase/admin";
import type {
  AchievementType,
  Leaderboard,
  LeaderboardFilters,
  LeaderboardRow,
  LeaderboardYear,
  Meta,
  OwnSubmission,
  PointsPreview,
  PublicStudent,
  PublicWork,
  ReviewQueueItem,
  RubricRow,
  SubmissionForReview,
  University,
} from "@/lib/types";
import { todayInTashkent, type Level, type ProfileBody, type Result } from "@/lib/validation";

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

export type CreateProfileResult = { ok: true } | { ok: false; reason: "exists" };

// Creates a student profile. Pilot sign-up is open, so any email is accepted (CLAUDE.md rule 6).
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

export async function countPendingSubmissions(studentId: string): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId)
    .eq("status", "pending");
  if (error) throw error;
  return count ?? 0;
}

// Upload URL requests are written to audit_log, which doubles as the per-student hourly counter.
const UPLOAD_URL_ACTION = "proof.upload_url";

export async function countUploadUrlRequestsSince(studentId: string, sinceIso: string): Promise<number> {
  const { count, error } = await getAdminClient()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("actor_id", studentId)
    .eq("action", UPLOAD_URL_ACTION)
    .gte("created_at", sinceIso);
  if (error) throw error;
  return count ?? 0;
}

export async function logUploadUrlRequest(studentId: string, submissionId: string, fileName: string): Promise<void> {
  const { error } = await getAdminClient().from("audit_log").insert({
    actor_id: studentId,
    action: UPLOAD_URL_ACTION,
    entity: "submission",
    entity_id: submissionId,
    details: { file_name: fileName },
  });
  if (error) throw error;
}

// The upload-url request this student made for this submission id, from audit_log (see logUploadUrlRequest).
export async function getIssuedUpload(
  studentId: string,
  submissionId: string,
): Promise<{ file_name: string; created_at: string } | null> {
  const { data, error } = await getAdminClient()
    .from("audit_log")
    .select("details, created_at")
    .eq("actor_id", studentId)
    .eq("action", UPLOAD_URL_ACTION)
    .eq("entity", "submission")
    .eq("entity_id", submissionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  const fileName = (data?.details as { file_name?: unknown } | null)?.file_name;
  return data && typeof fileName === "string" ? { file_name: fileName, created_at: data.created_at as string } : null;
}

// Extraction calls, counted for the per-student and global limits. Only the outcome is stored, never content.
const EXTRACT_ACTION = "proof.extract";

export async function countExtractionsSince(sinceIso: string, studentId?: string): Promise<number> {
  let query = getAdminClient()
    .from("audit_log")
    .select("id", { count: "exact", head: true })
    .eq("action", EXTRACT_ACTION)
    .gte("created_at", sinceIso);
  if (studentId) query = query.eq("actor_id", studentId);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function logExtraction(studentId: string, submissionId: string, outcome: string): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("audit_log")
    .insert({ actor_id: studentId, action: EXTRACT_ACTION, entity: "submission", entity_id: submissionId, details: { outcome } })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as number;
}

export async function setExtractionOutcome(logId: number, outcome: string): Promise<void> {
  const { error } = await getAdminClient().from("audit_log").update({ details: { outcome } }).eq("id", logId);
  if (error) console.error("extraction outcome not recorded", logId);
}

export type LiveDuplicate = { id: string; title: string; achievement_date: string; status: string; same_student: boolean; reason: "certificate_ref" | "title_date" };

// Other pending or approved submissions with the same certificate number, or the same student, title and date.
export async function findLiveDuplicates(s: {
  id: string;
  student_id: string;
  title: string;
  achievement_date: string;
  certificate_ref: string | null;
}): Promise<LiveDuplicate[]> {
  const db = getAdminClient();
  const ref = s.certificate_ref?.trim();
  const [byRef, byTitle] = await Promise.all([
    ref
      ? db
          .from("submissions")
          .select("id, student_id, title, achievement_date, status")
          .ilike("certificate_ref", ref.replace(/[\\%_]/g, (c) => `\\${c}`))
          .in("status", ["pending", "approved"])
          .neq("id", s.id)
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    db
      .from("submissions")
      .select("id, student_id, title, achievement_date, status")
      .eq("student_id", s.student_id)
      .eq("achievement_date", s.achievement_date)
      .ilike("title", s.title.trim().replace(/[\\%_]/g, (c) => `\\${c}`))
      .in("status", ["pending", "approved"])
      .neq("id", s.id)
      .limit(10),
  ]);
  if (byRef.error) throw byRef.error;
  if (byTitle.error) throw byTitle.error;
  const out = new Map<string, LiveDuplicate>();
  type Row = { id: string; student_id: string; title: string; achievement_date: string; status: string };
  for (const r of (byRef.data ?? []) as Row[]) {
    out.set(r.id, { id: r.id, title: r.title, achievement_date: r.achievement_date, status: r.status, same_student: r.student_id === s.student_id, reason: "certificate_ref" });
  }
  for (const r of (byTitle.data ?? []) as Row[]) {
    if (!out.has(r.id)) out.set(r.id, { id: r.id, title: r.title, achievement_date: r.achievement_date, status: r.status, same_student: true, reason: "title_date" });
  }
  return [...out.values()];
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
  ai_extraction?: unknown;
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
      "id, status, type_id, level, result, title, issuer, achievement_date, certificate_ref, note, student_comment, parent_id, submitted_at, file_path, ai_extraction, profiles(id, full_name, course, faculties(name))",
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

// ------------------------------------------------------------- leaderboard

// Cached leaderboard reads use "use cache: remote": on Vercel that is the shared runtime cache, so every
// function instance reads the same entries (plain "use cache" is in-memory per instance). Approvals call
// revalidateTag(LEADERBOARD_TAG) to purge them; otherwise entries refresh after about 30 seconds.
// Without a remote cache handler (local dev, self-hosting) Next falls back to the in-memory cache.
export const LEADERBOARD_TAG = "leaderboard";
const LEADERBOARD_CACHE = { stale: 30, revalidate: 30, expire: 300 };

// Academic year (start year) of today in Uzbekistan, from the SQL academic_year() function.
export async function getCurrentAcademicYear(): Promise<number> {
  const { data, error } = await getAdminClient().rpc("academic_year", { d: todayInTashkent() });
  if (error) throw error;
  return data as number;
}

type LeaderboardViewRow = {
  student_id: string;
  full_name: string;
  photo_path: string | null;
  university: string;
  faculty: string | null;
  total_points: number;
  approved_count: number;
};

function avatarUrl(path: string | null): string | null {
  return path ? getAdminClient().storage.from("avatars").getPublicUrl(path).data.publicUrl : null;
}

// Every ranked row for the filters. year = null means the current academic year.
// Rank is computed after filtering: points descending, ties go to the earlier last approval.
// Students with no approved points are left out (leaderboard_by_year already omits them).
export async function getLeaderboard(
  filters: Omit<LeaderboardFilters, "year"> & { year: LeaderboardYear | null },
): Promise<Leaderboard> {
  "use cache: remote";
  cacheTag(LEADERBOARD_TAG);
  cacheLife(LEADERBOARD_CACHE);

  const db = getAdminClient();
  const currentYear = await getCurrentAcademicYear();
  const year = filters.year ?? currentYear;

  let query = db
    .from(year === "all" ? "leaderboard" : "leaderboard_by_year")
    .select("student_id, full_name, photo_path, university, faculty, total_points, approved_count, last_approved_at")
    .gt("total_points", 0);
  if (year !== "all") query = query.eq("academic_year", year);
  if (filters.university_id) query = query.eq("university_id", filters.university_id);
  if (filters.faculty_id) query = query.eq("faculty_id", filters.faculty_id);

  const [list, years] = await Promise.all([
    query
      .order("total_points", { ascending: false })
      .order("last_approved_at", { ascending: true })
      .order("student_id", { ascending: true }),
    db.from("leaderboard_by_year").select("academic_year"),
  ]);
  if (list.error) throw list.error;
  if (years.error) throw years.error;

  const rows: LeaderboardRow[] = ((list.data ?? []) as LeaderboardViewRow[]).map((r, i) => ({
    rank: i + 1,
    student_id: r.student_id,
    full_name: r.full_name,
    university: r.university,
    faculty: r.faculty,
    photo_url: avatarUrl(r.photo_path),
    total_points: r.total_points,
    approved_count: r.approved_count,
  }));
  const available = new Set<number>([currentYear, ...(years.data ?? []).map((y) => y.academic_year as number)]);

  return {
    academic_year: year,
    current_academic_year: currentYear,
    available_years: [...available].sort((a, b) => b - a),
    rows,
    fallback_from_year: null,
  };
}

// The default view: the current academic year, or, while it has no entries for these filters,
// the most recent earlier year that has some (flagged with fallback_from_year).
export async function getDefaultLeaderboard(filters: Omit<LeaderboardFilters, "year">): Promise<Leaderboard> {
  const current = await getLeaderboard({ ...filters, year: null });
  if (current.rows.length > 0) return current;
  for (const year of current.available_years) {
    if (year >= current.current_academic_year) continue;
    const earlier = await getLeaderboard({ ...filters, year });
    if (earlier.rows.length > 0) return { ...earlier, fallback_from_year: current.current_academic_year };
  }
  return current;
}

// Public profile: approved works only, from public_works. Never includes files or file paths.
// Returns null for anyone who is not an active student on the leaderboard.
export async function getPublicStudent(studentId: string): Promise<PublicStudent | null> {
  "use cache: remote";
  cacheTag(LEADERBOARD_TAG);
  cacheLife(LEADERBOARD_CACHE);

  const db = getAdminClient();
  const [student, works, types] = await Promise.all([
    db
      .from("leaderboard")
      .select("student_id, full_name, photo_path, university, faculty, total_points")
      .eq("student_id", studentId)
      .maybeSingle(),
    db
      .from("public_works")
      .select("title, type_name, level, result, points_awarded, achievement_date")
      .eq("student_id", studentId)
      .order("achievement_date", { ascending: false }),
    db.from("achievement_types").select("id, name"),
  ]);
  if (student.error) throw student.error;
  if (works.error) throw works.error;
  if (types.error) throw types.error;
  if (!student.data) return null;

  const typeIds = new Map((types.data ?? []).map((x) => [x.name as string, x.id as number]));
  return {
    student_id: student.data.student_id,
    full_name: student.data.full_name,
    university: student.data.university,
    faculty: student.data.faculty,
    photo_url: avatarUrl(student.data.photo_path),
    total_points: student.data.total_points,
    works: ((works.data ?? []) as Omit<PublicWork, "type_id">[]).map((w) => ({
      ...w,
      type_id: typeIds.get(w.type_name) ?? null,
    })),
  };
}

// Reference data for the public filters; changes rarely.
export async function getUniversitiesCached(): Promise<University[]> {
  "use cache";
  cacheLife("minutes");
  return listUniversitiesWithFaculties();
}

// The student's own points in one academic year (dashboard). Not cached: it is per user.
export async function getYearPoints(studentId: string, academicYear: number): Promise<number> {
  const { data, error } = await getAdminClient()
    .from("leaderboard_by_year")
    .select("total_points")
    .eq("student_id", studentId)
    .eq("academic_year", academicYear)
    .maybeSingle();
  if (error) throw error;
  return data?.total_points ?? 0;
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
