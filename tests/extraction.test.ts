import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { findLiveDuplicates } from "@/lib/db";
import {
  EXTRACTION_MODEL,
  EXTRACTIONS_PER_HOUR,
  extractForStudent,
  type CallModel,
  type Extraction,
  type ExtractionRequest,
} from "@/lib/extraction";
import { getAdminClient } from "@/lib/supabase/admin";
import { createSubmissionFromUpload, issueProofUpload, UPLOAD_TICKET_MINUTES } from "@/lib/submissions";

import {
  createTestStudent,
  fields,
  insertAuditRows,
  rubricChoices,
  samplePdf,
  uploadProofBytes,
  type RubricChoice,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

const local = testRun("ext");
let alice: TestUser;
let bob: TestUser;
let simple: RubricChoice;

const RESULT: Extraction = {
  document_kind: "certificate",
  language: "uz_latin",
  title: "[TEST] Sertifikat",
  issuer: "TEST tashkilot",
  recipient_name: "TEST Alice",
  achievement_date: "2025-10-15",
  certificate_ref: "TEST-123",
  level_hint: "national",
  level_evidence: "Respublika",
  result_hint: "unknown",
  result_evidence: null,
  confidence: "high",
  warnings: [],
};

// Records every request the model would have received.
function stub(outcome: Awaited<ReturnType<CallModel>> = { ok: true, result: RESULT }) {
  const calls: ExtractionRequest[] = [];
  const call: CallModel = async (request) => {
    calls.push(request);
    return outcome;
  };
  return { call, calls };
}

async function uploaded(student: TestUser, bytes: Uint8Array, name: string, contentType: "application/pdf" | "image/png" | "image/jpeg") {
  const issued = await issueProofUpload(student.id, { file_name: name, size: bytes.length, content_type: contentType });
  if (!issued.ok) throw new Error(issued.code);
  await uploadProofBytes(issued.path, bytes, contentType);
  return issued;
}

async function pdfWithPages(n: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < n; i++) doc.addPage([300, 300]).drawText(`[TEST] page ${i + 1} ${Math.random()}`, { x: 20, y: 150, size: 12 });
  return doc.save();
}

const env = { ...process.env };
beforeEach(() => {
  process.env.AI_EXTRACTION_ENABLED = "true";
  process.env.ANTHROPIC_API_KEY = "test-key-not-used";
  delete process.env.AI_EXTRACTION_DAILY_CAP;
});
afterEach(() => {
  process.env.AI_EXTRACTION_ENABLED = env.AI_EXTRACTION_ENABLED;
  process.env.ANTHROPIC_API_KEY = env.ANTHROPIC_API_KEY;
  process.env.AI_EXTRACTION_DAILY_CAP = env.AI_EXTRACTION_DAILY_CAP;
});

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestStudent(local("alice"), "Alice"), createTestStudent(local("bob"), "Bob")]);
  simple = (await rubricChoices()).rows.find((r) => r.type_name !== "Journal article")!;
});

describe("POST /api/extract (extractForStudent)", () => {
  it("sends only the first 3 PDF pages and the prompt, no profile data, and returns a token that is stored on submit", async () => {
    const issued = await uploaded(alice, await pdfWithPages(5), "alice-cert.pdf", "application/pdf");
    const { call, calls } = stub();
    const res = await extractForStudent(alice.id, { submission_id: issued.submission_id, path: issued.path }, { call });
    expect(res).toMatchObject({ ok: true, result: RESULT });
    expect(calls).toHaveLength(1);

    const request = calls[0];
    expect(request.model).toBe(EXTRACTION_MODEL);
    expect(request).not.toHaveProperty("temperature");
    const content = request.messages[0].content as { type: string; source?: { data: string } }[];
    const doc = content.find((b) => b.type === "document")!;
    const sent = await PDFDocument.load(Buffer.from(doc.source!.data, "base64"));
    expect(sent.getPageCount()).toBe(3);

    // Nothing about the student: no name, email, id or file name anywhere in the request.
    const json = JSON.stringify(request);
    for (const secret of ["TEST Alice", alice.email, alice.id, "alice-cert"]) expect(json).not.toContain(secret);

    // The signed result ends up in submissions.ai_extraction.
    const created = await createSubmissionFromUpload(alice.id, {
      ...fields({ type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: "2025-10-15" }),
      submission_id: issued.submission_id,
      file_name: issued.file_name,
      upload_ticket: issued.upload_ticket,
      extraction_token: res.ok ? res.extraction_token : undefined,
    });
    expect(created).toMatchObject({ ok: true });
    const { data } = await getAdminClient().from("submissions").select("ai_extraction").eq("id", issued.submission_id).single();
    expect(data!.ai_extraction).toEqual(RESULT);

    // Once submitted, the upload cannot be extracted again.
    expect(await extractForStudent(alice.id, { submission_id: issued.submission_id, path: issued.path }, { call })).toMatchObject({
      ok: false,
      code: "invalid_path",
    });
  });

  it("downscales a large photo to 2000 px on the long side", async () => {
    const png = await sharp({ create: { width: 4000, height: 1500, channels: 3, background: { r: 200, g: 230, b: 210 } } })
      .png()
      .toBuffer();
    const issued = await uploaded(alice, new Uint8Array(png), "photo.png", "image/png");
    const { call, calls } = stub();
    expect(await extractForStudent(alice.id, { submission_id: issued.submission_id, path: issued.path }, { call })).toMatchObject({ ok: true });
    const image = (calls[0].messages[0].content as { type: string; source?: { data: string; media_type: string } }[]).find(
      (b) => b.type === "image",
    )!;
    const meta = await sharp(Buffer.from(image.source!.data, "base64")).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2000);
    expect(image.source!.media_type).toBe("image/jpeg");
  });

  it("refuses another student's path, an unknown id and an expired upload", async () => {
    const issued = await uploaded(alice, samplePdf("alice-own"), "a.pdf", "application/pdf");
    const { call, calls } = stub();
    const body = { submission_id: issued.submission_id, path: issued.path };
    expect(await extractForStudent(bob.id, body, { call })).toMatchObject({ ok: false, code: "invalid_path" });
    expect(await extractForStudent(bob.id, { ...body, path: `${bob.id}/${issued.submission_id}/a.pdf` }, { call })).toMatchObject({
      ok: false,
      code: "invalid_path",
    });
    expect(await extractForStudent(alice.id, { ...body, path: `${alice.id}/${issued.submission_id}/other.pdf` }, { call })).toMatchObject({
      ok: false,
      code: "invalid_path",
    });
    expect(await extractForStudent(alice.id, { submission_id: crypto.randomUUID(), path: issued.path }, { call })).toMatchObject({
      ok: false,
      code: "invalid_path",
    });
    const later = new Date(Date.now() + (UPLOAD_TICKET_MINUTES + 1) * 60_000);
    expect(await extractForStudent(alice.id, body, { call, now: later })).toMatchObject({ ok: false, code: "invalid_path" });
    expect(calls).toHaveLength(0);
  });

  it("refuses a file whose real signature does not match its extension", async () => {
    const issued = await uploaded(alice, samplePdf("pdf-named-png"), "scan.png", "image/png");
    const { call, calls } = stub();
    expect(await extractForStudent(alice.id, { submission_id: issued.submission_id, path: issued.path }, { call })).toMatchObject({
      ok: false,
      code: "file_type",
    });
    expect(calls).toHaveLength(0);
  });

  it("is off unless switched on", async () => {
    process.env.AI_EXTRACTION_ENABLED = "false";
    const { call, calls } = stub();
    expect(await extractForStudent(alice.id, { submission_id: crypto.randomUUID(), path: "x" }, { call })).toMatchObject({
      ok: false,
      status: 503,
      code: "extraction_disabled",
    });
    expect(calls).toHaveLength(0);
  });

  it(`stops at ${EXTRACTIONS_PER_HOUR} calls per student per hour, and at the global daily cap`, async () => {
    const carol = await createTestStudent(local("carol"), "Carol");
    const issued = await uploaded(carol, samplePdf("carol"), "c.pdf", "application/pdf");
    const body = { submission_id: issued.submission_id, path: issued.path };
    const { call, calls } = stub();

    process.env.AI_EXTRACTION_DAILY_CAP = "0";
    expect(await extractForStudent(carol.id, body, { call })).toMatchObject({ ok: false, status: 429, code: "extraction_busy" });
    delete process.env.AI_EXTRACTION_DAILY_CAP;

    await insertAuditRows(carol.id, "proof.extract", EXTRACTIONS_PER_HOUR);
    expect(await extractForStudent(carol.id, body, { call })).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
    expect(calls).toHaveLength(0);
  });

  it("reports a failed or refused model call without blocking the submission", async () => {
    const issued = await uploaded(bob, samplePdf("bob-fail"), "b.pdf", "application/pdf");
    const body = { submission_id: issued.submission_id, path: issued.path };
    expect(await extractForStudent(bob.id, body, stub({ ok: false, reason: "timeout" }))).toMatchObject({ ok: false, code: "extraction_failed" });
    expect(await extractForStudent(bob.id, body, stub({ ok: false, reason: "refusal" }))).toMatchObject({ ok: false, code: "extraction_failed" });

    // A forged extraction token is ignored; the submission still goes through, without ai_extraction.
    const created = await createSubmissionFromUpload(bob.id, {
      ...fields({ type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: "2025-10-15" }),
      submission_id: issued.submission_id,
      file_name: issued.file_name,
      upload_ticket: issued.upload_ticket,
      extraction_token: "eyJyZXN1bHQiOnt9fQ.forged",
    });
    expect(created).toMatchObject({ ok: true });
    const { data } = await getAdminClient().from("submissions").select("ai_extraction").eq("id", issued.submission_id).single();
    expect(data!.ai_extraction).toBeNull();
  });
});

describe("findLiveDuplicates (recognition check)", () => {
  it("finds the same certificate number on another live submission and the same student + title + date", async () => {
    const dave = await createTestStudent(local("dave"), "Dave");
    const erin = await createTestStudent(local("erin"), "Erin");
    const base = { type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: "2025-11-01" };
    const submit = async (student: TestUser, title: string, ref: string, label: string) => {
      const issued = await uploaded(student, samplePdf(label), "d.pdf", "application/pdf");
      const created = await createSubmissionFromUpload(student.id, {
        ...fields({ ...base, title, certificate_ref: ref }),
        submission_id: issued.submission_id,
        file_name: issued.file_name,
        upload_ticket: issued.upload_ticket,
      });
      if (!created.ok) throw new Error(created.code);
      return created.id;
    };
    const first = await submit(dave, "[TEST] Olimpiada", "TEST-DUP-1", "dup-1");
    const sameRefOther = await submit(erin, "[TEST] Boshqa", "test-dup-1", "dup-2");
    const sameTitle = await submit(dave, "[TEST] olimpiada", "TEST-OTHER", "dup-3");

    const found = await findLiveDuplicates({
      id: first,
      student_id: dave.id,
      title: "[TEST] Olimpiada",
      achievement_date: "2025-11-01",
      certificate_ref: "TEST-DUP-1",
    });
    expect(found.find((d) => d.id === sameRefOther)).toMatchObject({ reason: "certificate_ref", same_student: false });
    expect(found.find((d) => d.id === sameTitle)).toMatchObject({ reason: "title_date", same_student: true });
    expect(found.some((d) => d.id === first)).toBe(false);
  });
});
