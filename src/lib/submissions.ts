import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import {
  countPendingSubmissions,
  countUploadUrlRequestsSince,
  createProofUploadUrl,
  deleteProof,
  downloadProof,
  getAchievementType,
  getCountFrom,
  insertSubmission,
  isLiveFile,
  isOwnRejectedSubmission,
  logUploadUrlRequest,
  proofPath,
  rubricCombinationExists,
  submissionExists,
} from "@/lib/db";
import {
  JOURNAL_ARTICLE_TYPE_NAME,
  PROOF_MAX_BYTES,
  safeFileName,
  todayInTashkent,
  type SubmissionBody,
  type UploadUrlBody,
} from "@/lib/validation";

// The two server steps of adding an achievement (SPEC section 2). The route handlers only parse the body and
// check the session; the seed script and the tests call these functions directly, so all of them run the same rules.

// Per-student limits, so one account cannot fill the proofs bucket (pilot sign-up is open, CLAUDE.md rule 6).
export const MAX_PENDING_SUBMISSIONS = 20;
export const UPLOAD_URLS_PER_HOUR = 30;
// POST /api/submissions (and /api/extract) must follow upload-url within this window. The file is uploaded when the
// student picks it, before the form is filled in, so the window covers filling in the form. Supabase's own signed
// upload URL is valid for 2 hours and that cannot be configured, so this ticket is what bounds the upload.
export const UPLOAD_TICKET_MINUTES = 60;

export type Failure = { ok: false; status: number; code: string };

// --------------------------------------------------------------- file types

type ProofKind = "pdf" | "jpg" | "png";

const KIND_BY_CONTENT_TYPE: Record<UploadUrlBody["content_type"], ProofKind> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
};

const KIND_BY_EXTENSION: Record<string, ProofKind> = { pdf: "pdf", jpg: "jpg", jpeg: "jpg", png: "png" };

function kindFromFileName(fileName: string): ProofKind | null {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? (KIND_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null) : null;
}

// The real type, from the file signature. The declared content type and the extension are never trusted.
export function kindFromBytes(b: Uint8Array): ProofKind | null {
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "pdf"; // %PDF
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png"; // .PNG
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpg";
  return null;
}

// ------------------------------------------------------------ signed tokens

// Signed with a key derived from the secret key, which only the server has. "kind" separates the token types,
// so an upload ticket can never pass as an extraction token or the other way round.
type TokenKind = "upload" | "extraction";

function tokenKey(kind: TokenKind): Buffer {
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!secret) throw new Error("SUPABASE_SECRET_KEY must be set");
  return createHash("sha256").update(`jadid-${kind}-token:${secret}`).digest();
}

export function signToken(kind: TokenKind, payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", tokenKey(kind)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T>(kind: TokenKind, token: string): T | null {
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac("sha256", tokenKey(kind)).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString()) as T;
  } catch {
    return null;
  }
}

// Binds the submission id and file name to the student that upload-url issued them to, and carries the expiry.
type TicketPayload = { student_id: string; submission_id: string; file_name: string; exp: number };

export const signUploadTicket = (payload: TicketPayload) => signToken("upload", payload);
const verifyUploadTicket = (ticket: string) => verifyToken<TicketPayload>("upload", ticket);

// The raw extraction result, signed by /api/extract and stored in submissions.ai_extraction on submit.
// The browser carries it between the two calls but cannot change it.
export type ExtractionPayload = { student_id: string; submission_id: string; result: unknown; exp: number };

// ----------------------------------------------------- step 1: upload URL

export type IssuedUpload = {
  ok: true;
  submission_id: string;
  file_name: string;
  path: string;
  upload_url: string;
  upload_ticket: string;
};

// Reserves a submission id and returns a one-time upload URL for proofs/{student_id}/{submission_id}/{file_name}.
export async function issueProofUpload(
  studentId: string,
  body: UploadUrlBody,
  now: Date = new Date(),
): Promise<IssuedUpload | Failure> {
  const fileName = safeFileName(body.file_name);
  // The extension must match the declared type; POST /api/submissions then checks the real signature against it.
  if (kindFromFileName(fileName) !== KIND_BY_CONTENT_TYPE[body.content_type]) {
    return { ok: false, status: 400, code: "file_type" };
  }

  if ((await countPendingSubmissions(studentId)) >= MAX_PENDING_SUBMISSIONS) {
    return { ok: false, status: 429, code: "too_many_pending" };
  }
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  if ((await countUploadUrlRequestsSince(studentId, hourAgo)) >= UPLOAD_URLS_PER_HOUR) {
    return { ok: false, status: 429, code: "rate_limited" };
  }

  const submissionId = randomUUID();
  await logUploadUrlRequest(studentId, submissionId, fileName);
  const path = proofPath(studentId, submissionId, fileName);
  const uploadUrl = await createProofUploadUrl(path);
  const ticket = signUploadTicket({
    student_id: studentId,
    submission_id: submissionId,
    file_name: fileName,
    exp: now.getTime() + UPLOAD_TICKET_MINUTES * 60 * 1000,
  });
  return { ok: true, submission_id: submissionId, file_name: fileName, path, upload_url: uploadUrl, upload_ticket: ticket };
}

// ------------------------------------------------- step 3: create submission

// Validates the stored file and the form, then inserts the submission as pending.
// Any rejection after the ticket check deletes the stored file, so nothing unreferenced stays in the bucket.
export async function createSubmissionFromUpload(
  studentId: string,
  body: SubmissionBody,
  now: Date = new Date(),
): Promise<{ ok: true; id: string } | Failure> {
  const fail = (status: number, code: string): Failure => ({ ok: false, status, code });

  // The ticket proves upload-url issued this id and file name to this student, and recently.
  // A wrong or foreign ticket is refused before anything is deleted: the path may not be this student's.
  const ticket = verifyUploadTicket(body.upload_ticket);
  if (
    !ticket ||
    ticket.student_id !== studentId ||
    ticket.submission_id !== body.submission_id ||
    ticket.file_name !== body.file_name
  ) {
    return fail(400, "invalid_ticket");
  }

  // An id that already belongs to a submission must never reach reject(), which would delete its file.
  // This also makes each ticket usable once.
  if (await submissionExists(body.submission_id)) return fail(409, "invalid_body");

  // From here on the path is the student's own, issued by upload-url.
  const path = proofPath(studentId, ticket.submission_id, ticket.file_name);
  const reject = async (status: number, code: string): Promise<Failure> => {
    await deleteProof(path);
    return fail(status, code);
  };

  if (now.getTime() > ticket.exp) return reject(400, "upload_expired");
  if ((await countPendingSubmissions(studentId)) >= MAX_PENDING_SUBMISSIONS) {
    return reject(429, "too_many_pending");
  }

  // 3. The combination must exist in rubric_points. Types without placement are always "confirmed".
  const type = await getAchievementType(body.type_id);
  if (!type) return reject(400, "invalid_type");
  const result = type.has_placement ? body.result : "confirmed";
  if (!result || !(await rubricCombinationExists(type.id, body.level, result))) {
    return reject(400, "invalid_combination");
  }

  // 4. Date: not in the future, not before count_from.
  if (body.achievement_date > todayInTashkent()) return reject(400, "date_in_future");
  if (body.achievement_date < (await getCountFrom())) return reject(400, "date_too_early");

  // 5. Certificate reference is required for journal articles.
  if (type.name === JOURNAL_ARTICLE_TYPE_NAME && !body.certificate_ref) {
    return reject(400, "certificate_ref_required");
  }

  // 7. A resubmission must point to the student's own rejected submission.
  if (body.parent_id && !(await isOwnRejectedSubmission(body.parent_id, studentId))) {
    return reject(400, "invalid_parent");
  }

  // 2. File: PDF, JPG or PNG, 10 MB or less, checked on the stored bytes. Its real signature must match
  //    the extension that upload-url accepted for the declared type. SHA-256 computed here.
  const file = await downloadProof(path);
  if (!file) return fail(400, "file_missing");
  if (file.size > PROOF_MAX_BYTES) return reject(400, "file_too_large");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = kindFromBytes(bytes);
  if (!kind || kind !== kindFromFileName(ticket.file_name)) return reject(400, "file_type");
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  if (await isLiveFile(sha256)) return reject(409, "duplicate_file");

  // AI output for the reviewer (CLAUDE.md rule 2). Optional: a missing, forged or expired token is ignored.
  const extraction = body.extraction_token ? verifyToken<ExtractionPayload>("extraction", body.extraction_token) : null;
  const aiExtraction =
    extraction && extraction.student_id === studentId && extraction.submission_id === ticket.submission_id && now.getTime() <= extraction.exp
      ? extraction.result
      : null;

  const inserted = await insertSubmission({
    id: ticket.submission_id,
    student_id: studentId,
    type_id: type.id,
    level: body.level,
    result,
    title: body.title,
    issuer: body.issuer,
    achievement_date: body.achievement_date,
    certificate_ref: body.certificate_ref,
    note: body.note,
    file_path: path,
    file_sha256: sha256,
    parent_id: body.parent_id ?? null,
    student_comment: body.parent_id ? body.student_comment : null,
    ai_extraction: aiExtraction,
  });
  if (!inserted.ok) {
    // The unique index can still catch a duplicate that raced the check above.
    if (inserted.reason === "duplicate_file") return reject(409, "duplicate_file");
    // The id was taken between the check above and the insert: leave that submission's file alone.
    return fail(409, "invalid_body");
  }
  return { ok: true, id: ticket.submission_id };
}
