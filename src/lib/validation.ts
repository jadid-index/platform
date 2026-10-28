import { z } from "zod";

import { CONSENT_VERSION } from "@/lib/consent";

// Shared by the forms and the route handlers. The server always re-validates.

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const PASSWORD_MIN_LENGTH = 8;

export const profileBodySchema = z.object({
  full_name: z.string().trim().min(3).max(120),
  university_id: z.number().int().positive(),
  faculty_id: z.number().int().positive(),
  course: z.number().int().min(1).max(6),
  consent_version: z.literal(CONSENT_VERSION),
});

export type ProfileBody = z.infer<typeof profileBodySchema>;

// ---------------------------------------------------------------- submissions

export const LEVELS = ["university", "national", "international"] as const;
export const RESULTS = ["participant", "finalist", "winner", "confirmed"] as const;
export type Level = (typeof LEVELS)[number];
export type Result = (typeof RESULTS)[number];

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const NOTE_MAX_LENGTH = 300;
// Matches the seed; certificate_ref is required for this type (SPEC section 2, rule 5).
export const JOURNAL_ARTICLE_TYPE_NAME = "Journal article";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

// Step 1: ask for a one-time upload URL for the proof file.
export const uploadUrlBodySchema = z.object({
  file_name: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(PROOF_MAX_BYTES),
  content_type: z.enum(PROOF_CONTENT_TYPES),
});

export type UploadUrlBody = z.infer<typeof uploadUrlBodySchema>;

// Step 2: create the submission once the file is uploaded.
export const submissionBodySchema = z.object({
  submission_id: z.uuid(),
  file_name: z.string().trim().min(1).max(255),
  // Signed by upload-url; binds submission_id and file_name to the student (see src/lib/submissions.ts).
  upload_ticket: z.string().min(1).max(2000),
  // Signed by /api/extract; the server stores its result in ai_extraction (see src/lib/submissions.ts).
  extraction_token: z.string().max(20_000).optional(),
  type_id: z.number().int().positive(),
  level: z.enum(LEVELS),
  result: z.enum(RESULTS).optional(),
  title: z.string().trim().min(3).max(300),
  issuer: z.string().trim().min(2).max(300),
  achievement_date: z.iso.date(),
  certificate_ref: optionalText(500),
  note: optionalText(NOTE_MAX_LENGTH),
  parent_id: z.uuid().optional(),
  student_comment: optionalText(500),
});

export type SubmissionBody = z.infer<typeof submissionBodySchema>;

// POST /api/extract: the proof upload-url issued, before the submission exists.
export const extractBodySchema = z.object({
  submission_id: z.uuid(),
  path: z.string().min(1).max(600),
});

// Storage keys accept a limited character set, so keep the extension and replace everything unusual.
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+|_+$/g, "")
    .slice(0, 80);
  return `${base || "proof"}${ext ? `.${ext}` : ""}`;
}

// Today's date in Uzbekistan as YYYY-MM-DD.
export function todayInTashkent(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tashkent" }).format(new Date());
}

// -------------------------------------------------------------------- review

export const REJECTION_REASON_MAX_LENGTH = 1000;

export const approveBodySchema = z.object({
  type_id: z.number().int().positive(),
  level: z.enum(LEVELS),
  // Ignored for types without placement (always "confirmed").
  result: z.enum(RESULTS).optional(),
});

export const rejectBodySchema = z.object({
  reason: z.string().trim().min(1).max(REJECTION_REASON_MAX_LENGTH),
});

export const previewQuerySchema = z.object({
  type_id: z.coerce.number().int().positive(),
  level: z.enum(LEVELS),
  result: z.enum(RESULTS).optional(),
});

// Turns an exception raised by approve_submission() / reject_submission() into a stable code.
// Unknown messages map to "sql_error"; the server logs them and the client shows a generic error.
export function reviewErrorFromSql(message: string): { code: string; date?: string } {
  const early = /counting start date \((\d{4}-\d{2}-\d{2})\)/.exec(message);
  if (early) return { code: "date_too_early", date: early[1] };
  const known: Record<string, string> = {
    "submission not found": "not_found",
    "submission is not pending": "not_pending",
    "not an active reviewer": "forbidden",
    "reviewers cannot review their own submissions": "self_review",
    "invalid type / level / result combination": "invalid_combination",
    "a rejection reason is required": "reason_required",
  };
  return { code: known[message] ?? "sql_error" };
}

// --------------------------------------------------------------- leaderboard

const optionalId = z.coerce.number().int().positive().optional();

export const leaderboardQuerySchema = z.object({
  university_id: optionalId,
  faculty_id: optionalId,
  // Start year of the academic year (2026 = 2026/27), "all" for all-time; default is the current year.
  academic_year: z.union([z.literal("all"), z.coerce.number().int().min(2000).max(2100)]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
