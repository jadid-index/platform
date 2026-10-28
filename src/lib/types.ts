// Shared types that are safe to import from client components.
export type Faculty = { id: number; name: string };
export type University = { id: number; name: string; faculties: Faculty[] };

export type AchievementType = {
  id: number;
  category_code: string;
  name: string;
  base_points: number;
  has_placement: boolean;
  proof_hint: string | null;
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
  type_name: string;
  level: RubricRow["level"];
  result: RubricRow["result"];
  achievement_date: string;
  status: SubmissionStatus;
  submitted_at: string;
  points_awarded: number | null;
  rejection_reason: string | null;
};

export type ReviewQueueItem = {
  id: string;
  title: string;
  type_id: number;
  type_name: string;
  level: RubricRow["level"];
  result: RubricRow["result"];
  submitted_at: string;
  student_name: string;
  faculty: string | null;
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
// Public data only (CLAUDE.md rule 5): name, faculty, score, approved work titles, photo.

export type LeaderboardYear = number | "all"; // start year (2026 = 2026/27) or all-time

export type LeaderboardFilters = {
  year: LeaderboardYear;
  university_id?: number;
  faculty_id?: number;
};

export type LeaderboardRow = {
  rank: number;
  student_id: string;
  full_name: string;
  university: string;
  faculty: string | null;
  photo_url: string | null;
  total_points: number;
  approved_count: number;
};

export type Leaderboard = {
  academic_year: LeaderboardYear;
  current_academic_year: number;
  available_years: number[]; // newest first, always includes the current year
  rows: LeaderboardRow[]; // every ranked row for these filters
  // Set when the default view fell back from an empty current year to the most recent year with data.
  fallback_from_year: number | null;
};

export type PublicWork = {
  title: string;
  type_id: number | null;
  type_name: string;
  level: RubricRow["level"];
  result: RubricRow["result"];
  points_awarded: number;
  achievement_date: string;
};

export type PublicStudent = {
  student_id: string;
  full_name: string;
  university: string;
  faculty: string | null;
  photo_url: string | null;
  total_points: number;
  works: PublicWork[];
};
