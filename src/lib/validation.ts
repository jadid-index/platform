import { z } from "zod";

import { CONSENT_VERSION, EMPLOYER_TERMS_VERSION } from "@/lib/consent";
import { CV_LANGUAGE_LEVELS, CV_VISIBILITIES, FILE_VISIBILITIES } from "@/lib/types";

// Shared by the forms and the route handlers. The server always re-validates.

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email());

export const PASSWORD_MIN_LENGTH = 8;

// Phone (digits, spaces, dashes, brackets, optional leading +) or a Telegram username (@name).
export const PHONE_RE = /^\+?[0-9][0-9 ()-]{6,19}$/;
export const TELEGRAM_RE = /^@[A-Za-z0-9_]{5,32}$/;
export const phoneSchema = z.string().trim().regex(PHONE_RE);
export const telegramSchema = z.string().trim().regex(TELEGRAM_RE);

export const studentProfileBodySchema = z.strictObject({
  role: z.literal("student"),
  full_name: z.string().trim().min(3).max(120),
  university_id: z.number().int().positive(),
  faculty_id: z.number().int().positive(),
  course: z.number().int().min(1).max(6),
  consent_version: z.literal(CONSENT_VERSION),
});

export const employerProfileBodySchema = z.strictObject({
  role: z.literal("employer"),
  company_name: z.string().trim().min(2).max(120),
  contact_person: z.string().trim().min(3).max(120),
  contact: z.union([phoneSchema, telegramSchema]),
  terms_version: z.literal(EMPLOYER_TERMS_VERSION),
});

// POST /api/profile. The only roles anyone may choose for themselves are student and employer (CLAUDE.md rule 10).
// Strict: any key that does not belong to the chosen shape (verified, status, a second role field, ...) is a 400.
export const profileBodySchema = z.discriminatedUnion("role", [studentProfileBodySchema, employerProfileBodySchema]);

export type StudentProfileBody = z.infer<typeof studentProfileBodySchema>;
export type EmployerProfileBody = z.infer<typeof employerProfileBodySchema>;
export type ProfileBody = z.infer<typeof profileBodySchema>;

// ----------------------------------------------------------------- employers

export const CONTACT_MESSAGE_MAX = 500;
export const CONTACT_KINDS = ["phone", "telegram", "email"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];
export const TALENT_PAGE_SIZE = 20;

export const openToWorkBodySchema = z.strictObject({ open_to_work: z.boolean() });

export const contactRequestBodySchema = z.strictObject({
  student_id: z.uuid(),
  message: z.string().trim().min(1).max(CONTACT_MESSAGE_MAX),
});

// Accept with exactly one contact detail of the chosen kind, or decline with nothing else.
export const contactResponseBodySchema = z.union([
  z.strictObject({ action: z.literal("decline") }),
  z.strictObject({ action: z.literal("accept"), kind: z.literal("phone"), value: phoneSchema }),
  z.strictObject({ action: z.literal("accept"), kind: z.literal("telegram"), value: telegramSchema }),
  z.strictObject({ action: z.literal("accept"), kind: z.literal("email"), value: emailSchema }),
]);
export type ContactResponseBody = z.infer<typeof contactResponseBodySchema>;

const optionalQueryId = z.coerce.number().int().positive().optional().catch(undefined);

export const talentQuerySchema = z.object({
  faculty_id: optionalQueryId,
  tier: z.string().trim().regex(/^[A-Za-z0-9+-]{1,8}$/).optional().catch(undefined),
  category: z.string().trim().regex(/^[a-z_]{1,40}$/).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type TalentQuery = z.infer<typeof talentQuerySchema>;

// Exceptions raised by the employer SQL functions are already stable codes (20261107000000).
export const CONTACT_ERRORS: Record<string, number> = {
  not_active_employer: 403,
  employer_profile_missing: 403,
  not_active_student: 403,
  student_not_available: 404,
  invalid_message: 400,
  duplicate_pending: 409,
  already_accepted: 409,
  declined_cooldown: 409,
  rate_limited: 429,
  rate_limited_global: 429,
  not_found: 404,
  already_answered: 409,
  contact_required: 400,
};

// ------------------------------------------------------------------------ CV
// PUT /api/me/cv and PATCH /api/me/cv/visibility. The same limits are checked again by cv_content_valid() and the
// column checks in SQL (20261108000000). Lengths count characters (code points), like Postgres char_length().

export const CV_LIMITS = {
  about: 600,
  skills: 20,
  skill: 40,
  languages: 8,
  language: 40,
  experience: 10,
  expTitle: 120,
  expOrganization: 120,
  expDescription: 300,
  links: 5,
  linkLabel: 40,
  linkUrl: 300,
  city: 80,
} as const;

export const charLength = (s: string) => Array.from(s).length;

// Control characters (C0, DEL, C1) and bidi overrides that could disguise text. Newlines only where allowed.
const CONTROL_RE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const CONTROL_OR_NEWLINE_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;

function cvText(min: number, max: number, newlines = false) {
  return z
    .string()
    .transform((s) => s.replace(/\r\n?/g, "\n").trim())
    .refine((s) => charLength(s) >= min && charLength(s) <= max, { message: "length" })
    .refine((s) => !(newlines ? CONTROL_RE : CONTROL_OR_NEWLINE_RE).test(s), { message: "control_characters" });
}

export const CV_MONTH_RE = /^(19[5-9]\d|20\d\d)-(0[1-9]|1[0-2])$/;
export const currentMonthInTashkent = () => todayInTashkent().slice(0, 7);
const cvMonth = z
  .string()
  .regex(CV_MONTH_RE)
  .refine((m) => m <= currentMonthInTashkent(), { message: "future_month" });

// The same shape as the SQL check: https, a dotted host, no user:password@ part.
const CV_URL_RE = /^https:\/\/[^\s/?#@\\]+\.[^\s/?#@\\]+([/?#]\S*)?$/;

// Returns the normalized https URL, or null. Used by the schema and again when a link is rendered.
export function safeHttpsUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const host = url.hostname;
  if (!host.includes(".") || host.startsWith(".") || host.endsWith(".")) return null;
  const href = url.href;
  if (charLength(href) > CV_LIMITS.linkUrl || !CV_URL_RE.test(href)) return null;
  return href;
}

const cvUrl = z.string().transform((raw, ctx) => {
  const href = safeHttpsUrl(raw);
  if (!href) {
    ctx.addIssue({ code: "custom", message: "https_only" });
    return z.NEVER;
  }
  return href;
});

// An optional contact: "" or null is stored as null.
function optionalContact<T extends z.ZodType<string>>(schema: T) {
  return z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable());
}

export const cvExperienceSchema = z
  .strictObject({
    title: cvText(1, CV_LIMITS.expTitle),
    organization: cvText(1, CV_LIMITS.expOrganization),
    start: cvMonth,
    end: cvMonth.nullable(),
    description: cvText(0, CV_LIMITS.expDescription, true),
  })
  .refine((e) => e.end === null || e.end >= e.start, { path: ["end"], message: "end_before_start" });

export const cvBodySchema = z.strictObject({
  about: cvText(0, CV_LIMITS.about, true),
  skills: z
    .array(cvText(1, CV_LIMITS.skill))
    .max(CV_LIMITS.skills)
    .refine((a) => new Set(a.map((s) => s.toLowerCase())).size === a.length, { message: "duplicate_skill" }),
  languages: z
    .array(z.strictObject({ name: cvText(1, CV_LIMITS.language), level: z.enum(CV_LANGUAGE_LEVELS) }))
    .max(CV_LIMITS.languages),
  experience: z.array(cvExperienceSchema).max(CV_LIMITS.experience),
  links: z.array(z.strictObject({ label: cvText(1, CV_LIMITS.linkLabel), url: cvUrl })).max(CV_LIMITS.links),
  contact_phone: optionalContact(phoneSchema),
  contact_email: optionalContact(emailSchema.pipe(z.string().max(254))),
  contact_telegram: optionalContact(
    z
      .string()
      .trim()
      .transform((v) => (v.startsWith("@") ? v : `@${v}`))
      .pipe(telegramSchema),
  ),
  contact_city: optionalContact(cvText(2, CV_LIMITS.city)),
});
export type CvBody = z.infer<typeof cvBodySchema>;

export const cvVisibilityBodySchema = z
  .strictObject({ visibility: z.enum(CV_VISIBILITIES), confirm: z.literal(true).optional() })
  .refine((b) => b.visibility !== "public" || b.confirm === true, { path: ["confirm"], message: "confirmation_required" });
export type CvVisibilityBody = z.infer<typeof cvVisibilityBodySchema>;

// Exceptions raised by save_cv() / set_cv_visibility().
export const CV_ERRORS: Record<string, number> = {
  not_active_student: 403,
  invalid_cv: 400,
  rate_limited: 429,
  confirmation_required: 400,
};

// ---------------------------------------------------------------- submissions

export const LEVELS = ["university", "national", "international"] as const;
export const RESULTS = ["participant", "finalist", "winner", "confirmed"] as const;
export type Level = (typeof LEVELS)[number];
export type Result = (typeof RESULTS)[number];

export const PROOF_MAX_BYTES = 10 * 1024 * 1024;
export const PROOF_CONTENT_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export const NOTE_MAX_LENGTH = 300;

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

// PATCH /api/submissions/:id/visibility. 'public' needs confirm: true (the checkbox in the dialog).
export const visibilityBodySchema = z
  .strictObject({ visibility: z.enum(FILE_VISIBILITIES), confirm: z.literal(true).optional() })
  .refine((b) => b.visibility !== "public" || b.confirm === true, { path: ["confirm"], message: "confirmation_required" });

// -------------------------------------------------------------------- review

// PATCH /api/review/submissions/:id/sensitive
export const sensitiveBodySchema = z.strictObject({ flag: z.boolean() });

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

// -------------------------------------------------------------------- admin

export const ROLES = ["student", "reviewer", "employer", "admin"] as const;
export type Role = (typeof ROLES)[number];
// Every value of profile_status. Only "active" is public; admins set "active" or "hidden".
export const PROFILE_STATUSES = ["active", "hidden", "pending", "rejected"] as const;
export type ProfileStatus = (typeof PROFILE_STATUSES)[number];
export const ADMIN_SETTABLE_STATUSES = ["active", "hidden"] as const;

const optionalQueryText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d) => !Number.isNaN(Date.parse(d)));

export const adminUsersQuerySchema = z.object({
  q: optionalQueryText(120),
  role: z.enum(ROLES).optional(),
  status: z.enum(PROFILE_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
// Optional keys stay optional for callers that build a query by hand (tests, scripts).
export type AdminUsersQuery = Partial<z.infer<typeof adminUsersQuerySchema>> & { limit: number; offset: number };

// Exactly one change per request, so each change gets its own audit row.
export const adminUserPatchSchema = z.union([
  z.strictObject({ role: z.enum(ROLES) }),
  z.strictObject({ status: z.enum(ADMIN_SETTABLE_STATUSES) }),
  z.strictObject({ employer_verified: z.boolean() }),
]);
export type AdminUserPatch = z.infer<typeof adminUserPatchSchema>;

export const adminAuditQuerySchema = z.object({
  actor: optionalQueryText(120),
  action: optionalQueryText(80),
  from: isoDay.optional(),
  to: isoDay.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminAuditQuery = Partial<z.infer<typeof adminAuditQuerySchema>> & { limit: number; offset: number };

// Maps exceptions raised by admin_set_role() / admin_set_status() to stable API codes.
export function adminErrorFromSql(message: string): string {
  const known: Record<string, string> = {
    "not an admin": "forbidden",
    "user not found": "not_found",
    "last admin": "last_admin",
    "invalid status": "invalid_body",
    "not an employer": "not_employer",
  };
  return known[message] ?? "sql_error";
}

// ------------------------------------------------------------------- rubric

export const REASON_MIN = 3;
export const REASON_MAX = 200;
export const CAP_MAX = 1000;

const reason = z.string().trim().min(REASON_MIN).max(REASON_MAX);
const int = z.number().int();

const typeName = z.object({
  uz: z.string().trim().min(2).max(120),
  en: z.string().trim().max(120).optional(),
  ru: z.string().trim().max(120).optional(),
});

// Range checks against the yearly cap happen in SQL, which knows the cap at the moment of the change.
export const typeBodySchema = z.strictObject({
  name: typeName,
  category_code: z.string().trim().min(1).max(40),
  base_points: int.min(0).max(CAP_MAX),
  has_placement: z.boolean(),
  proof_hint: z.string().trim().max(300).optional().transform((v) => v || null),
  certificate_ref_required: z.boolean(),
  reason,
});
export type TypeBody = z.infer<typeof typeBodySchema>;

export const typePatchSchema = z.union([typeBodySchema, z.strictObject({ active: z.boolean(), reason })]);
export const reasonBodySchema = z.strictObject({ reason });

export const pointsBodySchema = z.strictObject({
  cells: z
    .array(
      z.strictObject({
        type_id: int.positive(),
        level: z.enum(LEVELS),
        result: z.enum(RESULTS),
        points: int.min(0).max(CAP_MAX).nullable(), // null removes the cell
      }),
    )
    .min(1)
    .max(200),
  reason,
});
export type PointsCell = z.infer<typeof pointsBodySchema>["cells"][number];

export const capBodySchema = z.strictObject({ yearly_cap: int.min(1).max(CAP_MAX), reason });

// Tiers: what the public sees instead of points. sort_order is derived from min_points in SQL.
export const TIER_CODE = /^[A-Za-z0-9+-]{1,8}$/;
export const TIER_MIN_MAX = 100000;
export const tierBodySchema = z.strictObject({
  code: z.string().trim().regex(TIER_CODE),
  label: z.object({
    uz: z.string().trim().min(1).max(60),
    en: z.string().trim().max(60).optional(),
    ru: z.string().trim().max(60).optional(),
  }),
  min_points: int.min(1).max(TIER_MIN_MAX),
  reason,
});
export type TierBody = z.infer<typeof tierBodySchema>;

// Maps exceptions raised by the admin rubric functions to stable API codes and HTTP statuses.
const RUBRIC_ERRORS: Record<string, [string, number]> = {
  "not an admin": ["forbidden", 403],
  "reason required": ["reason_required", 400],
  "name required": ["name_required", 400],
  "name taken": ["name_taken", 409],
  "invalid value": ["invalid_body", 400],
  "invalid cell": ["invalid_cell", 400],
  "too many cells": ["invalid_cell", 400],
  "duplicate cell": ["duplicate_cell", 400],
  "points out of range": ["points_out_of_range", 400],
  "cap out of range": ["cap_out_of_range", 400],
  "result does not fit type": ["result_mismatch", 400],
  "category not found": ["not_found", 404],
  "type not found": ["not_found", 404],
  "type has submissions": ["type_has_submissions", 409],
  "cell in use": ["cell_in_use", 409],
  "cap below points": ["cap_below_points", 409],
  "invalid tier code": ["invalid_tier_code", 400],
  "tier code taken": ["tier_code_taken", 409],
  "tier min taken": ["tier_min_taken", 409],
  "tier not found": ["not_found", 404],
  "last tier": ["last_tier", 409],
};

export function rubricErrorFromSql(message: string): { code: string; status: number } {
  const known = RUBRIC_ERRORS[message];
  return known ? { code: known[0], status: known[1] } : { code: "sql_error", status: 500 };
}
