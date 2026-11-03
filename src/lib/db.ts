import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { recognitionChecks } from "@/lib/recognition";
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
  RejectedSubmission,
  ReviewQueueItem,
  RubricRow,
  OwnStanding,
  PublicTier,
  SubmissionForReview,
  Tier,
  TopTier,
  TypeName,
  University,
} from "@/lib/types";
import {
  adminErrorFromSql,
  rubricErrorFromSql,
  todayInTashkent,
  type AdminAuditQuery,
  type AdminUsersQuery,
  type Level,
  type PointsCell,
  type ProfileBody,
  type ProfileStatus,
  type Result,
  type Role,
  type TierBody,
  type TypeBody,
} from "@/lib/validation";

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
  role: Role;
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

// The student form gets active types only (inactive ones cannot be submitted). The review screen passes
// includeInactive, so a pending submission of a type deactivated since still shows its type.
export async function getMeta(opts: { includeInactive?: boolean } = {}): Promise<Meta> {
  const db = getAdminClient();
  let typesQuery = db.from("achievement_types").select("id, category_code, name, base_points, has_placement, proof_hint, active, certificate_ref_required").order("id");
  if (!opts.includeInactive) typesQuery = typesQuery.eq("active", true);
  const [universities, types, rubric, countFrom] = await Promise.all([
    listUniversitiesWithFaculties(),
    typesQuery,
    db.from("rubric_points").select("type_id, level, result, points").order("type_id").order("points"),
    getCountFrom(),
  ]);
  if (types.error) throw types.error;
  if (rubric.error) throw rubric.error;
  const achievementTypes = (types.data ?? []) as AchievementType[];
  const typeIds = new Set(achievementTypes.map((x) => x.id));
  return {
    universities,
    achievement_types: achievementTypes,
    // Only cells of the returned types, so the form never offers a combination of an inactive type.
    rubric_points: ((rubric.data ?? []) as RubricRow[]).filter((r) => typeIds.has(r.type_id)),
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
): Promise<{ role: Role; status: ProfileStatus } | null> {
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
    .select("id, category_code, name, base_points, has_placement, proof_hint, active, certificate_ref_required")
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

  const typeNames = new Map((types.data ?? []).map((t) => [t.id as number, t.name as TypeName]));
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
      type_name: typeNames.get(s.type_id) ?? { uz: "" },
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
// Exact points are for the owner, reviewers and admins only (rule 11); read them from the reviews ledger.
// year = "all" sums every year (the all-time tier uses the best single year instead, see getBestYearPoints).
export async function getTotalPoints(studentId: string): Promise<number> {
  return sumApprovedPoints(studentId);
}

async function sumApprovedPoints(studentId: string, academicYear?: number): Promise<number> {
  let query = getAdminClient()
    .from("reviews")
    .select("points_awarded")
    .eq("student_id", studentId)
    .eq("decision", "approved");
  if (academicYear !== undefined) query = query.eq("academic_year", academicYear);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).reduce((sum, r) => sum + ((r.points_awarded as number | null) ?? 0), 0);
}

// Points per academic year for several students, for reviewer and admin screens.
export async function getYearPointsFor(studentIds: string[], academicYear: number): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (studentIds.length === 0) return out;
  const { data, error } = await getAdminClient()
    .from("reviews")
    .select("student_id, points_awarded")
    .in("student_id", studentIds)
    .eq("decision", "approved")
    .eq("academic_year", academicYear);
  if (error) throw error;
  for (const r of data ?? []) out.set(r.student_id as string, (out.get(r.student_id as string) ?? 0) + ((r.points_awarded as number | null) ?? 0));
  return out;
}

// The student's own standing for one academic year, or all-time (the best academic year, like the public
// all-time tier). For the owner only: it carries exact points.
export async function getOwnStanding(studentId: string, year: LeaderboardYear): Promise<OwnStanding> {
  if (year !== "all") {
    const points = await sumApprovedPoints(studentId, year);
    return { academic_year: year, points, tier: await getTierFor(points) };
  }
  const { data, error } = await getAdminClient()
    .from("reviews")
    .select("academic_year, points_awarded")
    .eq("student_id", studentId)
    .eq("decision", "approved");
  if (error) throw error;
  const perYear = new Map<number, number>();
  for (const r of data ?? []) {
    const y = r.academic_year as number;
    perYear.set(y, (perYear.get(y) ?? 0) + ((r.points_awarded as number | null) ?? 0));
  }
  let best: { year: number; points: number } | null = null;
  for (const [y, p] of perYear) if (!best || p > best.points || (p === best.points && y > best.year)) best = { year: y, points: p };
  const points = best?.points ?? 0;
  return { academic_year: best?.year ?? null, points, tier: await getTierFor(points) };
}

// The tier for a number of points, from the tiers table (tier_for() in SQL). null below the lowest tier.
export async function getTierFor(points: number): Promise<PublicTier | null> {
  const { data, error } = await getAdminClient().rpc("tier_for", { p_points: points });
  if (error) throw error;
  const row = (data as { code: string; label: TypeName; sort_order: number }[] | null)?.[0];
  return row ? { code: row.code, label: row.label, sort_order: row.sort_order } : null;
}

// Same rule as tier_for() in SQL, for a list already loaded: the highest min_points the points reach.
export function tierFromList(points: number, tiers: Tier[]): PublicTier | null {
  const t = tiers.filter((x) => x.min_points <= points).sort((a, b) => b.min_points - a.min_points)[0];
  return t ? { code: t.code, label: t.label, sort_order: t.sort_order } : null;
}

export async function listTiers(): Promise<Tier[]> {
  const { data, error } = await getAdminClient().from("tiers").select("code, label, min_points, sort_order").order("sort_order");
  if (error) throw error;
  return (data ?? []) as Tier[];
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

async function typeNames(): Promise<Map<number, TypeName>> {
  const { data, error } = await getAdminClient().from("achievement_types").select("id, name");
  if (error) throw error;
  return new Map((data ?? []).map((t) => [t.id as number, t.name as TypeName]));
}

type StudentEmbed = { id: string; full_name: string; course: number | null; faculties: { name: string } | null };

// Recognition checks marked "check" (same code as the review screen). null when there is nothing to compare:
// no AI result, or the AI found none of the name, date and certificate number on the document.
function flagCount(extraction: unknown, profileName: string, achievementDate: string, certificateRef: string | null) {
  if (!extraction) return null;
  const checks = recognitionChecks(extraction as Parameters<typeof recognitionChecks>[0], {
    profile_name: profileName,
    achievement_date: achievementDate,
    certificate_ref: certificateRef,
  });
  if (checks.every((c) => c.status === "missing")) return null;
  return checks.filter((c) => c.status === "check").length;
}

// Pending submissions, oldest first, each with its flag count (see flagCount).
export async function listReviewQueue(): Promise<ReviewQueueItem[]> {
  const [subs, names] = await Promise.all([
    getAdminClient()
      .from("submissions")
      .select(
        "id, title, type_id, level, result, submitted_at, achievement_date, certificate_ref, ai_extraction, profiles(id, full_name, course, faculties(name))",
      )
      .eq("status", "pending")
      .order("submitted_at", { ascending: true }),
    typeNames(),
  ]);
  if (subs.error) throw subs.error;
  // Reviewers see exact points: each student's total in the current academic year.
  const studentIds = [
    ...new Set((subs.data ?? []).map((s) => (s.profiles as unknown as StudentEmbed | null)?.id).filter((x): x is string => !!x)),
  ];
  const yearPoints = await getYearPointsFor(studentIds, await getCurrentAcademicYear());
  return (subs.data ?? []).map((s) => {
    const student = s.profiles as unknown as StudentEmbed | null;
    return {
      id: s.id,
      title: s.title,
      type_id: s.type_id,
      type_name: names.get(s.type_id) ?? { uz: "" },
      level: s.level,
      result: s.result,
      submitted_at: s.submitted_at,
      student_name: student?.full_name ?? "",
      faculty: student?.faculties?.name ?? null,
      flag_count: flagCount(s.ai_extraction, student?.full_name ?? "", s.achievement_date, s.certificate_ref),
      student_year_points: student ? (yearPoints.get(student.id) ?? 0) : 0,
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

// Public rows: tier, name, faculty and approved-work metadata. Never points, rank or approval times (rule 11);
// the views do not have those columns.
type LeaderboardViewRow = {
  student_id: string;
  full_name: string;
  photo_path: string | null;
  university: string;
  faculty: string | null;
  approved_count: number;
  tier_code: string | null;
  tier_label: TypeName | null;
  tier_sort: number | null;
};

const PUBLIC_ROW_COLUMNS =
  "student_id, full_name, photo_path, university, faculty, approved_count, tier_code, tier_label, tier_sort";

function avatarUrl(path: string | null): string | null {
  return path ? getAdminClient().storage.from("avatars").getPublicUrl(path).data.publicUrl : null;
}

function tierOf(r: { tier_code: string | null; tier_label: TypeName | null; tier_sort: number | null }): PublicTier | null {
  return r.tier_code && r.tier_label && r.tier_sort !== null
    ? { code: r.tier_code, label: r.tier_label, sort_order: r.tier_sort }
    : null;
}

// Uzbek collation, case- and accent-insensitive, so "Gʻulom" and "gulom" sort together.
const byName = new Intl.Collator("uz", { sensitivity: "base" });

// Public order: tier (best first, no tier last), then name. There is no rank and no tie-breaking by approval.
export function comparePublicRows(a: LeaderboardRow, b: LeaderboardRow): number {
  const ta = a.tier?.sort_order ?? Number.MAX_SAFE_INTEGER;
  const tb = b.tier?.sort_order ?? Number.MAX_SAFE_INTEGER;
  return ta - tb || byName.compare(a.full_name, b.full_name) || a.student_id.localeCompare(b.student_id);
}

// Every row for the filters, in public order. year = null means the current academic year.
// Only students with at least one approved work in the period are listed; the tier comes from that year's
// points (all-time: the student's best academic year).
export async function getLeaderboard(
  filters: Omit<LeaderboardFilters, "year"> & { year: LeaderboardYear | null },
): Promise<Leaderboard> {
  "use cache: remote";
  cacheTag(LEADERBOARD_TAG);
  cacheLife(LEADERBOARD_CACHE);

  const db = getAdminClient();
  const currentYear = await getCurrentAcademicYear();
  const year = filters.year ?? currentYear;

  let query = db.from(year === "all" ? "leaderboard" : "leaderboard_by_year").select(PUBLIC_ROW_COLUMNS);
  if (year !== "all") query = query.eq("academic_year", year);
  if (filters.university_id) query = query.eq("university_id", filters.university_id);
  if (filters.faculty_id) query = query.eq("faculty_id", filters.faculty_id);

  const [list, years] = await Promise.all([query, db.from("leaderboard_by_year").select("academic_year")]);
  if (list.error) throw list.error;
  if (years.error) throw years.error;

  const rows: LeaderboardRow[] = ((list.data ?? []) as LeaderboardViewRow[])
    .map((r) => ({
      student_id: r.student_id,
      full_name: r.full_name,
      university: r.university,
      faculty: r.faculty,
      photo_url: avatarUrl(r.photo_path),
      approved_count: r.approved_count,
      tier: tierOf(r),
    }))
    .sort(comparePublicRows);
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

// Landing page: the best tier that has anyone in the default view, its first students by name, and how many
// it has in total. Students without a tier never count as a top tier.
export async function getTopTierStudents(limit: number): Promise<TopTier> {
  const board = await getDefaultLeaderboard({});
  const first = board.rows.find((r) => r.tier !== null);
  if (!first) return { academic_year: board.academic_year, tier: null, rows: [], total: 0 };
  const inTier = board.rows.filter((r) => r.tier?.code === first.tier!.code);
  return { academic_year: board.academic_year, tier: first.tier, rows: inTier.slice(0, limit), total: inTier.length };
}

// Public profile: tier (best year, plus the current year), name, faculty and approved works with level and
// result only. Never points, files or file paths. null for anyone who is not an active student with approved work.
export async function getPublicStudent(studentId: string): Promise<PublicStudent | null> {
  "use cache: remote";
  cacheTag(LEADERBOARD_TAG);
  cacheLife(LEADERBOARD_CACHE);

  const db = getAdminClient();
  const currentYear = await getCurrentAcademicYear();
  const [student, thisYear, works] = await Promise.all([
    db.from("leaderboard").select(PUBLIC_ROW_COLUMNS).eq("student_id", studentId).maybeSingle(),
    db
      .from("leaderboard_by_year")
      .select("tier_code, tier_label, tier_sort")
      .eq("student_id", studentId)
      .eq("academic_year", currentYear)
      .maybeSingle(),
    db
      .from("public_works")
      .select("title, type_id, type_name, level, result, achievement_date")
      .eq("student_id", studentId)
      .order("achievement_date", { ascending: false }),
  ]);
  if (student.error) throw student.error;
  if (thisYear.error) throw thisYear.error;
  if (works.error) throw works.error;
  if (!student.data) return null;

  const row = student.data as LeaderboardViewRow;
  return {
    student_id: row.student_id,
    full_name: row.full_name,
    university: row.university,
    faculty: row.faculty,
    photo_url: avatarUrl(row.photo_path),
    approved_count: row.approved_count,
    tier: tierOf(row),
    current_year: {
      academic_year: currentYear,
      tier: thisYear.data ? tierOf(thisYear.data as LeaderboardViewRow) : null,
    },
    works: (works.data ?? []) as PublicWork[],
  };
}

export async function getLatestWorkDates(studentIds: string[], year: LeaderboardYear): Promise<Record<string, string>> {
  "use cache: remote";
  cacheTag(LEADERBOARD_TAG);
  cacheLife(LEADERBOARD_CACHE);

  if (studentIds.length === 0) return {};
  let query = getAdminClient().from("public_works").select("student_id, achievement_date").in("student_id", studentIds);
  if (year !== "all") query = query.gte("achievement_date", `${year}-09-01`).lt("achievement_date", `${year + 1}-09-01`);
  const { data, error } = await query;
  if (error) throw error;
  const latest: Record<string, string> = {};
  for (const w of (data ?? []) as { student_id: string; achievement_date: string }[]) {
    if (!latest[w.student_id] || w.achievement_date > latest[w.student_id]) latest[w.student_id] = w.achievement_date;
  }
  return latest;
}

export type PublicCounts = { students: number; approved: number; universities: number };

// Landing page counters: numbers only, nothing that identifies a student. Refreshed every 5 minutes.
// Approved works are counted for active students only, the same set the leaderboard shows.
export async function getPublicCounts(): Promise<PublicCounts> {
  "use cache: remote";
  cacheLife({ stale: 300, revalidate: 300, expire: 3600 });

  const db = getAdminClient();
  const [students, approved, universities] = await Promise.all([
    db.from("profiles").select("id", { count: "exact", head: true }).eq("role", "student").eq("status", "active"),
    db.from("leaderboard").select("approved_count").gt("approved_count", 0),
    db.from("universities").select("id", { count: "exact", head: true }),
  ]);
  if (students.error) throw students.error;
  if (approved.error) throw approved.error;
  if (universities.error) throw universities.error;
  return {
    students: students.count ?? 0,
    approved: ((approved.data ?? []) as { approved_count: number }[]).reduce((sum, r) => sum + r.approved_count, 0),
    universities: universities.count ?? 0,
  };
}

// Reference data for the public filters; changes rarely.
export async function getUniversitiesCached(): Promise<University[]> {
  "use cache";
  cacheLife("minutes");
  return listUniversitiesWithFaculties();
}

export type CategoryProgress = { code: string; points: number; cap: number };

// The student's approved points per category in one academic year, next to each category's yearly cap.
// Reads the points_awarded that approve_submission() stored (the same rows the review screen's "used" comes
// from); nothing is computed from the rubric here. Not cached: it is per user.
export async function getCategoryProgress(studentId: string, academicYear: number): Promise<CategoryProgress[]> {
  const db = getAdminClient();
  const [categories, reviews] = await Promise.all([
    db.from("categories").select("code, yearly_cap").order("code"),
    db
      .from("reviews")
      .select("category_code, points_awarded")
      .eq("student_id", studentId)
      .eq("decision", "approved")
      .eq("academic_year", academicYear),
  ]);
  if (categories.error) throw categories.error;
  if (reviews.error) throw reviews.error;
  const used = new Map<string, number>();
  for (const r of reviews.data ?? []) {
    used.set(r.category_code as string, (used.get(r.category_code as string) ?? 0) + ((r.points_awarded as number) ?? 0));
  }
  return (categories.data ?? []).map((c) => ({
    code: c.code as string,
    points: used.get(c.code as string) ?? 0,
    cap: c.yearly_cap as number,
  }));
}

// Academic years in which the student has approved work, newest first (dashboard year selector).
export async function getStudentYears(studentId: string): Promise<number[]> {
  const { data, error } = await getAdminClient()
    .from("leaderboard_by_year")
    .select("academic_year")
    .eq("student_id", studentId);
  if (error) throw error;
  return (data ?? []).map((r) => r.academic_year as number).sort((a, b) => b - a);
}

// One rejected submission of the student's own, to pre-fill a resubmission. Never another student's.
export async function getOwnRejectedSubmission(submissionId: string, studentId: string): Promise<RejectedSubmission | null> {
  const { data, error } = await getAdminClient()
    .from("submissions")
    .select("id, type_id, level, result, title, issuer, achievement_date, certificate_ref, reviews(rejection_reason)")
    .eq("id", submissionId)
    .eq("student_id", studentId)
    .eq("status", "rejected")
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const review = (Array.isArray(data.reviews) ? data.reviews[0] : data.reviews) as { rejection_reason: string | null } | null;
  return {
    id: data.id as string,
    type_id: data.type_id as number,
    level: data.level as Level,
    result: data.result as Result,
    title: data.title as string,
    issuer: data.issuer as string,
    achievement_date: data.achievement_date as string,
    certificate_ref: (data.certificate_ref as string | null) ?? null,
    rejection_reason: review?.rejection_reason ?? null,
  };
}

// The student's own points in one academic year (dashboard). Not cached: it is per user.
export async function getYearPoints(studentId: string, academicYear: number): Promise<number> {
  return sumApprovedPoints(studentId, academicYear);
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

// ------------------------------------------------------------------- admin

// The admin list functions return the full match count on every row (count(*) over ()).
function withoutTotal<T extends { total_count: number }>(row: T): Omit<T, "total_count"> {
  const copy: Partial<T> = { ...row };
  delete copy.total_count;
  return copy as Omit<T, "total_count">;
}

export type AdminUser = {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  status: ProfileStatus;
  university: string | null;
  faculty: string | null;
  created_at: string;
  year_points: number | null; // students only: approved points in the current academic year
  tier: PublicTier | null;
};

export async function listUsersForAdmin(query: AdminUsersQuery): Promise<{ rows: AdminUser[]; total: number }> {
  const { data, error } = await getAdminClient().rpc("admin_list_users", {
    p_q: query.q ?? null,
    p_role: query.role ?? null,
    p_status: query.status ?? null,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  if (error) throw error;
  const rows = (data ?? []) as (Omit<AdminUser, "year_points" | "tier"> & { total_count: number })[];
  // Admins see exact points: students' current-year points and the tier they give.
  const students = rows.filter((r) => r.role === "student").map((r) => r.id);
  const [points, tiers] = students.length
    ? await Promise.all([getYearPointsFor(students, await getCurrentAcademicYear()), listTiers()])
    : [new Map<string, number>(), [] as Tier[]];
  return {
    rows: rows.map(withoutTotal).map((r) => {
      const p = r.role === "student" ? (points.get(r.id) ?? 0) : null;
      return { ...r, year_points: p, tier: p === null ? null : tierFromList(p, tiers) };
    }),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

export type AdminChange<T> = { ok: true; old: T; new: T; changed: boolean } | { ok: false; code: string; message: string };

// Both run SQL functions that check the actor is an active admin, refuse to leave zero active admins and write
// the audit_log row in the same transaction. A role change to student without faculty / course / consent
// fails on the student_fields check (23514).
async function adminChange<T>(fn: "admin_set_role" | "admin_set_status", args: Record<string, unknown>): Promise<AdminChange<T>> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (!error) {
    const result = data as { old: T; new: T; changed: boolean };
    return { ok: true, old: result.old, new: result.new, changed: result.changed };
  }
  if (error.code === "P0001") return { ok: false, code: adminErrorFromSql(error.message), message: error.message };
  if (error.code === "23514") return { ok: false, code: "student_fields_missing", message: error.message };
  throw error;
}

export function setUserRole(actorId: string, targetId: string, role: Role): Promise<AdminChange<Role>> {
  return adminChange("admin_set_role", { p_actor: actorId, p_target: targetId, p_role: role });
}

export function setUserStatus(actorId: string, targetId: string, status: "active" | "hidden"): Promise<AdminChange<ProfileStatus>> {
  return adminChange("admin_set_status", { p_actor: actorId, p_target: targetId, p_status: status });
}

export type AuditEntry = {
  id: number;
  actor_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  entity: string;
  entity_id: string;
  target_name: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export async function listAuditLog(query: AdminAuditQuery): Promise<{ rows: AuditEntry[]; total: number }> {
  const { data, error } = await getAdminClient().rpc("admin_list_audit", {
    p_actor: query.actor ?? null,
    p_action: query.action ?? null,
    p_from: query.from ?? null,
    p_to: query.to ?? null,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  if (error) throw error;
  const rows = (data ?? []) as (AuditEntry & { total_count: number })[];
  return {
    rows: rows.map(withoutTotal),
    total: rows[0] ? Number(rows[0].total_count) : 0,
  };
}

export async function listAuditActions(): Promise<string[]> {
  const { data, error } = await getAdminClient().rpc("admin_audit_actions");
  if (error) throw error;
  return (data ?? []) as string[];
}

// ------------------------------------------------------------ rubric admin

export type AdminCategory = { code: string; name: string; yearly_cap: number };
export type AdminType = AchievementType & { in_use: boolean };
export type AdminRubric = { categories: AdminCategory[]; types: AdminType[]; cells: RubricRow[]; tiers: Tier[] };

// Everything the editor shows, inactive types included. in_use: a submission or review refers to the type, so it
// cannot be deleted or switch has_placement.
export async function getRubricForAdmin(): Promise<AdminRubric> {
  const db = getAdminClient();
  const [categories, types, cells, tiers] = await Promise.all([
    db.from("categories").select("code, name, yearly_cap").order("code"),
    db
      .from("achievement_types")
      .select("id, category_code, name, base_points, has_placement, proof_hint, active, certificate_ref_required")
      .order("id"),
    db.from("rubric_points").select("type_id, level, result, points").order("type_id"),
    listTiers(),
  ]);
  for (const r of [categories, types, cells]) if (r.error) throw r.error;

  // Count queries per type, not a list of rows: PostgREST returns at most 1000 rows per request.
  const list = (types.data ?? []) as AchievementType[];
  const inUse = await Promise.all(
    list.map(async (x) => {
      const [subs, reviews] = await Promise.all([
        db.from("submissions").select("id", { count: "exact", head: true }).eq("type_id", x.id),
        db.from("reviews").select("id", { count: "exact", head: true }).eq("final_type_id", x.id),
      ]);
      if (subs.error) throw subs.error;
      if (reviews.error) throw reviews.error;
      return (subs.count ?? 0) + (reviews.count ?? 0) > 0;
    }),
  );
  return {
    categories: (categories.data ?? []) as AdminCategory[],
    types: list.map((x, i) => ({ ...x, in_use: inUse[i] })),
    cells: (cells.data ?? []) as RubricRow[],
    tiers,
  };
}

export type RubricOutcome<T> = { ok: true; data: T } | { ok: false; code: string; status: number; message: string };

// The SQL functions check the admin, the reason and every range, and write the audit rows.
async function rubricCall<T>(fn: string, args: Record<string, unknown>): Promise<RubricOutcome<T>> {
  const { data, error } = await getAdminClient().rpc(fn, args);
  if (!error) return { ok: true, data: data as T };
  if (error.code === "P0001") return { ok: false, ...rubricErrorFromSql(error.message), message: error.message };
  throw error;
}

export function saveAchievementType(actorId: string, id: number | null, body: TypeBody) {
  return rubricCall<AchievementType>("admin_save_type", {
    p_actor: actorId,
    p_id: id,
    p_name: body.name,
    p_category: body.category_code,
    p_base: body.base_points,
    p_has_placement: body.has_placement,
    p_proof_hint: body.proof_hint,
    p_cert_required: body.certificate_ref_required,
    p_reason: body.reason,
  });
}

export function setAchievementTypeActive(actorId: string, id: number, active: boolean, reason: string) {
  return rubricCall<AchievementType>("admin_set_type_active", { p_actor: actorId, p_id: id, p_active: active, p_reason: reason });
}

export function deleteAchievementType(actorId: string, id: number, reason: string) {
  return rubricCall<null>("admin_delete_type", { p_actor: actorId, p_id: id, p_reason: reason });
}

export function setRubricPoints(actorId: string, cells: PointsCell[], reason: string) {
  return rubricCall<number>("admin_set_rubric_points", { p_actor: actorId, p_cells: cells, p_reason: reason });
}

export function setCategoryCap(actorId: string, code: string, cap: number, reason: string) {
  return rubricCall<AdminCategory>("admin_set_category_cap", { p_actor: actorId, p_code: code, p_cap: cap, p_reason: reason });
}

// Tiers. The SQL functions check the admin and the reason, keep codes and thresholds unique, renumber
// sort_order from min_points and write the audit row.
export function saveTier(actorId: string, oldCode: string | null, body: TierBody) {
  return rubricCall<Tier>("admin_save_tier", {
    p_actor: actorId,
    p_old_code: oldCode,
    p_code: body.code,
    p_label: body.label,
    p_min: body.min_points,
    p_reason: body.reason,
  });
}

export function deleteTier(actorId: string, code: string, reason: string) {
  return rubricCall<null>("admin_delete_tier", { p_actor: actorId, p_code: code, p_reason: reason });
}
