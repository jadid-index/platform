// Shared types that are safe to import from client components.
export type Faculty = { id: number; name: string };
export type University = { id: number; name: string; faculties: Faculty[] };

// Type names are stored per language in achievement_types.name; "uz" is always set.
export type TypeName = { uz: string; en?: string; ru?: string };

export type AchievementType = {
  id: number;
  category_code: string;
  name: TypeName;
  base_points: number;
  has_placement: boolean;
  proof_hint: string | null;
  active: boolean; // inactive types are hidden from the student form and cannot be submitted
  certificate_ref_required: boolean;
};

export type RubricRow = {
  type_id: number;
  level: "university" | "national" | "international";
  result: "participant" | "finalist" | "winner" | "confirmed";
  points: number;
};

export type Meta = {
  universities: University[];
  achievement_types: AchievementType[];
  rubric_points: RubricRow[];
  count_from: string; // YYYY-MM-DD; achievements dated earlier are not scored
};

export type SubmissionStatus = "pending" | "approved" | "rejected" | "withdrawn";

// What a student sees about their own submission. Never includes the file path.
export type OwnSubmission = {
  id: string;
  title: string;
  type_id: number;
  type_name: TypeName;
  level: RubricRow["level"];
  result: RubricRow["result"];
  achievement_date: string;
  status: SubmissionStatus;
  submitted_at: string;
  points_awarded: number | null;
  rejection_reason: string | null;
  file_visibility: FileVisibility;
  sensitive_data_flag: boolean;
};

// Who may open an approved work's document (CLAUDE.md rule 4). The sensitive flag overrides it to private.
export const FILE_VISIBILITIES = ["private", "verified", "public"] as const;
export type FileVisibility = (typeof FILE_VISIBILITIES)[number];

// A student's own rejected submission, used to pre-fill its resubmission. Never includes the file.
export type RejectedSubmission = {
  id: string;
  type_id: number;
  level: RubricRow["level"];
  result: RubricRow["result"];
  title: string;
  issuer: string;
  achievement_date: string;
  certificate_ref: string | null;
  rejection_reason: string | null;
};

export type ReviewQueueItem = {
  id: string;
  title: string;
  type_id: number;
  type_name: TypeName;
  level: RubricRow["level"];
  result: RubricRow["result"];
  submitted_at: string;
  student_name: string;
  faculty: string | null;
  flag_count: number | null; // recognition checks marked "check"; null when nothing could be compared
  student_year_points: number; // reviewers see exact points: the student's total this academic year
};

export type SubmissionForReview = {
  id: string;
  status: SubmissionStatus;
  type_id: number;
  level: RubricRow["level"];
  result: RubricRow["result"];
  title: string;
  issuer: string;
  achievement_date: string;
  certificate_ref: string | null;
  note: string | null;
  student_comment: string | null;
  parent_id: string | null;
  submitted_at: string;
  file_path: string;
  sensitive_data_flag: boolean;
  ai_extraction: unknown; // raw extraction result (src/lib/extraction.ts), null when there was none
  student: { id: string; full_name: string; faculty: string | null; course: number | null };
};

// Shown on the review screen. approve_submission() computes the real value when the reviewer approves.
export type PointsPreview = {
  rubric_points: number | null; // null: the combination is not in rubric_points
  category_code: string;
  academic_year: number; // start year, 2025 = 2025/26
  used: number; // points the student already has in this category and academic year
  cap: number;
  awarded: number; // what approval would award after the yearly cap
};

// ------------------------------------------------------------- leaderboard
// Public data only (CLAUDE.md rules 5 and 11): name, faculty, tier, approved works (no points), photo.

export type LeaderboardYear = number | "all"; // start year (2026 = 2026/27) or all-time

export type LeaderboardFilters = {
  year: LeaderboardYear;
  university_id?: number;
  faculty_id?: number;
};

// A tier as the public sees it. Points never travel with it.
export type PublicTier = { code: string; label: TypeName; sort_order: number }; // sort_order 1 = best
export type Tier = PublicTier & { min_points: number }; // admin and owner views only

// The signed-in student's own points and tier. Never sent to anyone else.
export type OwnStanding = {
  academic_year: number | null; // all-time: the best academic year (null when there is none)
  points: number;
  tier: PublicTier | null;
};

export type LeaderboardRow = {
  student_id: string;
  full_name: string;
  university: string;
  faculty: string | null;
  photo_url: string | null;
  approved_count: number;
  tier: PublicTier | null; // null: approved work, but below the lowest tier ("–")
};

export type Leaderboard = {
  academic_year: LeaderboardYear;
  current_academic_year: number;
  available_years: number[]; // newest first, always includes the current year
  rows: LeaderboardRow[]; // every row for these filters, by tier (best first) then name
  // Set when the default view fell back from an empty current year to the most recent year with data.
  fallback_from_year: number | null;
};

export type PublicWork = {
  submission_id: string;
  title: string;
  type_id: number;
  type_name: TypeName;
  level: RubricRow["level"];
  result: RubricRow["result"];
  achievement_date: string;
  issuer: string;
  certificate_ref: string | null;
  file_public: boolean; // the student made the file public and no reviewer flagged it
};

// One approved work on its public page: the work plus its student's name. Never points or files.
export type PublicWorkPage = PublicWork & {
  student_id: string;
  full_name: string;
  university: string;
  faculty: string | null;
};

export type PublicStudent = {
  student_id: string;
  full_name: string;
  university: string;
  faculty: string | null;
  photo_url: string | null;
  approved_count: number;
  tier: PublicTier | null; // all-time: the best academic year
  current_year: { academic_year: number; tier: PublicTier | null };
  works: PublicWork[];
};

export type TopTier = {
  academic_year: LeaderboardYear;
  tier: PublicTier | null; // the best tier with anyone in it; null when nobody has a tier
  rows: LeaderboardRow[];
  total: number; // everyone in that tier
};
