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

// ------------------------------------------------------------------ employers

// One row of the talent directory (/talent). Same public fields as the leaderboard: never points, rank or contacts.
export type TalentRow = {
  student_id: string;
  full_name: string;
  university: string | null;
  faculty: string | null;
  approved_count: number;
  tier: PublicTier | null; // all-time: the best academic year
};

// cv_available: this viewer may open the student's CV (cvAccess(), rule 12); cv_file_available: the student uploaded
// a CV file and this viewer may download it (same rule). Booleans only, never CV data.
export type TalentListRow = TalentRow & { cv_available: boolean; cv_file_available: boolean };
export type TalentPage<R = TalentRow> = { rows: R[]; total: number; page: number; page_size: number };
export type TalentList = TalentPage<TalentListRow>;

// A work in the directory: the public metadata plus whether this viewer may open the document (canViewFile()).
export type TalentWork = PublicWork & { can_view_file: boolean };

export type ContactRequestStatus = "pending" | "accepted" | "declined";

// What the employer knows about its own request. shared_contact is set only after the student accepted
// (and only while the student is active).
export type EmployerRequestState = {
  id: string;
  status: ContactRequestStatus;
  created_at: string;
  responded_at: string | null;
  resend_after: string | null; // declined: the day a new request is allowed
  shared_contact: { kind: "phone" | "telegram" | "email"; value: string } | null;
};

export type TalentStudent = Omit<TalentRow, "approved_count"> & {
  approved_count: number;
  works: TalentWork[];
  request: EmployerRequestState | null; // the latest request of this employer, if any
  cv_available: boolean;
  cv_file_available: boolean;
};

export type EmployerSentRequest = EmployerRequestState & {
  student_id: string;
  full_name: string;
  message: string;
};

// What the student sees: who asks (company, contact person, verified mark) and the message.
export type StudentContactRequest = {
  id: string;
  status: ContactRequestStatus;
  message: string;
  created_at: string;
  responded_at: string | null;
  company_name: string | null;
  contact_person: string | null;
  employer_verified: boolean;
  shared_contact_kind: "phone" | "telegram" | "email" | null;
};

// ------------------------------------------------------------------------ CV
// The in-app CV (migration 20261108000000, CLAUDE.md rule 12). Typed by the student ("self-declared"); education
// comes from the profile and "verified achievements" from the approved works, both read at view time.

export const CV_VISIBILITIES = ["private", "verified", "public"] as const;
export type CvVisibility = (typeof CV_VISIBILITIES)[number];
export const CV_LANGUAGE_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2", "native"] as const;
export type CvLanguageLevel = (typeof CV_LANGUAGE_LEVELS)[number];

export type CvLanguage = { name: string; level: CvLanguageLevel };
export type CvExperience = {
  title: string;
  organization: string;
  start: string; // YYYY-MM
  end: string | null; // YYYY-MM, null = present
  description: string;
};
export type CvLink = { label: string; url: string }; // https only
export type CvContent = {
  about: string;
  skills: string[];
  languages: CvLanguage[];
  experience: CvExperience[];
  links: CvLink[];
};
export type CvContacts = {
  contact_phone: string | null;
  contact_email: string | null;
  contact_telegram: string | null;
  contact_city: string | null;
};
// What the student edits (PUT /api/me/cv). The visibility is changed separately.
export type CvDoc = CvContent & CvContacts;

// An approved work on the CV: metadata only, never points or rank.
export type CvWork = Pick<PublicWork, "submission_id" | "title" | "type_name" | "issuer" | "achievement_date" | "level" | "result">;

// The CV as one viewer may see it. `course` and `contacts` are left out of the object (not set to null) when the
// viewer may not see them, so they can never reach a public response.
export type CvView = {
  student_id: string;
  full_name: string;
  university: string | null;
  faculty: string | null;
  course?: number;
  tier: PublicTier | null; // all-time: the best academic year
  content: CvContent;
  contacts?: CvContacts;
  works: CvWork[];
  updated_at: string | null;
};

// The owner's editor data (GET /api/me/cv).
export type OwnCv = {
  doc: CvDoc;
  visibility: CvVisibility;
  public_confirmed_at: string | null;
  updated_at: string | null;
  view: CvView; // the full CV, for the live preview
  file: OwnCvFile | null; // the uploaded CV, if any
};

// The owner's uploaded CV: what the /cv card shows. Never the storage object name.
export type OwnCvFile = { file_name: string; size: number; uploaded_at: string };
