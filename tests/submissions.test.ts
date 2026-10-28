import { beforeAll, describe, expect, it } from "vitest";

import { getCountFrom } from "@/lib/db";
import {
  createSubmissionFromUpload,
  issueProofUpload,
  MAX_PENDING_SUBMISSIONS,
  UPLOAD_TICKET_MINUTES,
  UPLOAD_URLS_PER_HOUR,
} from "@/lib/submissions";

import {
  createTestStudent,
  fields,
  insertAuditRows,
  insertPendingRow,
  PNG_SIGNATURE,
  proofExists,
  rubricChoices,
  samplePdf,
  submitThroughApiPath,
  uploadProofBytes,
  type RubricChoice,
  type TestUser,
} from "../scripts/lib/test-data";
import { testRun } from "./helpers";

const local = testRun("sub");
let alice: TestUser;
let bob: TestUser;
let simple: RubricChoice; // a valid combination that needs no certificate_ref
const DATE = "2025-10-15";

const pdf = (label: string) => ({ bytes: samplePdf(label), name: "proof.pdf", contentType: "application/pdf" as const });
const valid = (over: Partial<Parameters<typeof fields>[0]> = {}) =>
  fields({ type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: DATE, ...over });

beforeAll(async () => {
  [alice, bob] = await Promise.all([createTestStudent(local("alice"), "Alice"), createTestStudent(local("bob"), "Bob")]);
  const { rows } = await rubricChoices();
  simple = rows.find((r) => r.type_name !== "Journal article")!;
});

describe("POST /api/submissions path (issueProofUpload + createSubmissionFromUpload)", () => {
  it("accepts a valid PDF and stores it as pending", async () => {
    const { created, path } = await submitThroughApiPath(alice.id, valid(), pdf("ok"));
    expect(created).toMatchObject({ ok: true });
    expect(await proofExists(path!)).toBe(true);
  });

  it("refuses an invalid type / level / result combination and deletes the stored file", async () => {
    const { created, path } = await submitThroughApiPath(alice.id, valid({ result: "winner", type_id: 32000 }), pdf("bad-combo"));
    expect(created).toMatchObject({ ok: false, code: "invalid_type" });
    expect(await proofExists(path!)).toBe(false);

    // A real type with a combination that is not in rubric_points.
    const { rows } = await rubricChoices();
    const placementType = rows.find((r) => r.result === "winner")!;
    const taken = new Set(rows.filter((r) => r.type_id === placementType.type_id).map((r) => `${r.level}/${r.result}`));
    const missing = (["university", "national", "international"] as const)
      .flatMap((level) => (["participant", "finalist", "winner"] as const).map((result) => ({ level, result })))
      .find((c) => !taken.has(`${c.level}/${c.result}`));
    // For a type without placement, any result other than "confirmed" is forced to "confirmed", so test the
    // placement type with a missing combination when the rubric has one.
    if (missing) {
      const res = await submitThroughApiPath(alice.id, valid({ type_id: placementType.type_id, ...missing }), pdf("missing-combo"));
      expect(res.created).toMatchObject({ ok: false, code: "invalid_combination" });
      expect(await proofExists(res.path!)).toBe(false);
    }
  });

  it("refuses a date before count_from (2023-09-01) and deletes the stored file", async () => {
    expect(await getCountFrom()).toBe("2023-09-01");
    const { created, path } = await submitThroughApiPath(alice.id, valid({ achievement_date: "2023-08-31" }), pdf("early"));
    expect(created).toMatchObject({ ok: false, code: "date_too_early" });
    expect(await proofExists(path!)).toBe(false);
  });

  it("refuses a duplicate file and deletes only the second copy", async () => {
    const bytes = samplePdf("duplicate");
    const first = await submitThroughApiPath(alice.id, valid(), { ...pdf(""), bytes });
    expect(first.created).toMatchObject({ ok: true });
    const second = await submitThroughApiPath(bob.id, valid(), { ...pdf(""), bytes });
    expect(second.created).toMatchObject({ ok: false, status: 409, code: "duplicate_file" });
    expect(await proofExists(second.path!)).toBe(false);
    expect(await proofExists(first.path!)).toBe(true);
  });

  it("refuses a file whose real signature does not match its declared type, and deletes it", async () => {
    // Declared PNG (name and content type), real bytes PDF.
    const issued = await issueProofUpload(alice.id, { file_name: "photo.png", size: 2000, content_type: "image/png" });
    if (!issued.ok) throw new Error(issued.code);
    const path = `${alice.id}/${issued.submission_id}/${issued.file_name}`;
    await uploadProofBytes(path, samplePdf("pdf-as-png"), "image/png");
    const created = await createSubmissionFromUpload(alice.id, {
      ...valid(),
      submission_id: issued.submission_id,
      file_name: issued.file_name,
      upload_ticket: issued.upload_ticket,
    });
    expect(created).toMatchObject({ ok: false, code: "file_type" });
    expect(await proofExists(path)).toBe(false);

    // Declared PDF but named .png is refused before any URL is issued.
    expect(await issueProofUpload(alice.id, { file_name: "x.png", size: 10, content_type: "application/pdf" })).toMatchObject({
      ok: false,
      code: "file_type",
    });
    // Real PNG signature with a PDF declaration is refused too.
    const res = await submitThroughApiPath(alice.id, valid(), { bytes: PNG_SIGNATURE, name: "scan.pdf", contentType: "application/pdf" });
    expect(res.created).toMatchObject({ ok: false, code: "file_type" });
  });

  it("refuses another student's file path and leaves that file alone", async () => {
    const issued = await issueProofUpload(alice.id, { file_name: "mine.pdf", size: 2000, content_type: "application/pdf" });
    if (!issued.ok) throw new Error(issued.code);
    const alicePath = `${alice.id}/${issued.submission_id}/${issued.file_name}`;
    await uploadProofBytes(alicePath, samplePdf("alice-only"), "application/pdf");
    const body = { ...valid(), submission_id: issued.submission_id, file_name: issued.file_name };

    // Bob replays Alice's submission id, file name and even her ticket.
    expect(await createSubmissionFromUpload(bob.id, { ...body, upload_ticket: issued.upload_ticket })).toMatchObject({
      ok: false,
      code: "invalid_ticket",
    });
    // Bob with his own ticket but Alice's submission id.
    const own = await issueProofUpload(bob.id, { file_name: "mine.pdf", size: 2000, content_type: "application/pdf" });
    if (!own.ok) throw new Error(own.code);
    expect(await createSubmissionFromUpload(bob.id, { ...body, upload_ticket: own.upload_ticket })).toMatchObject({
      ok: false,
      code: "invalid_ticket",
    });
    // A forged ticket.
    expect(await createSubmissionFromUpload(bob.id, { ...body, upload_ticket: "eyJ4IjoxfQ.forged" })).toMatchObject({
      ok: false,
      code: "invalid_ticket",
    });
    expect(await proofExists(alicePath)).toBe(true);

    // Alice can still use her own upload, once.
    const mine = { ...body, upload_ticket: issued.upload_ticket };
    expect(await createSubmissionFromUpload(alice.id, mine)).toMatchObject({ ok: true });
    expect(await createSubmissionFromUpload(alice.id, mine)).toMatchObject({ ok: false, status: 409 });
    expect(await proofExists(alicePath)).toBe(true);
  });

  it("refuses an upload ticket older than the window and deletes the file", async () => {
    const issued = await issueProofUpload(alice.id, { file_name: "late.pdf", size: 2000, content_type: "application/pdf" });
    if (!issued.ok) throw new Error(issued.code);
    const path = `${alice.id}/${issued.submission_id}/${issued.file_name}`;
    await uploadProofBytes(path, samplePdf("late"), "application/pdf");
    const later = new Date(Date.now() + (UPLOAD_TICKET_MINUTES + 1) * 60_000);
    const created = await createSubmissionFromUpload(
      alice.id,
      { ...valid(), submission_id: issued.submission_id, file_name: issued.file_name, upload_ticket: issued.upload_ticket },
      later,
    );
    expect(created).toMatchObject({ ok: false, code: "upload_expired" });
    expect(await proofExists(path)).toBe(false);
  });
});

describe("per-student limits", () => {
  it(`stops at ${MAX_PENDING_SUBMISSIONS} pending submissions`, async () => {
    const carol = await createTestStudent(local("carol"), "Carol");
    for (let i = 0; i < MAX_PENDING_SUBMISSIONS; i++) {
      await insertPendingRow(carol.id, { type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: DATE });
    }
    expect(await issueProofUpload(carol.id, { file_name: "a.pdf", size: 10, content_type: "application/pdf" })).toMatchObject({
      ok: false,
      status: 429,
      code: "too_many_pending",
    });
  });

  it(`stops at ${UPLOAD_URLS_PER_HOUR} upload URLs per hour`, async () => {
    const dave = await createTestStudent(local("dave"), "Dave");
    await insertAuditRows(dave.id, "proof.upload_url", UPLOAD_URLS_PER_HOUR - 1);
    expect(await issueProofUpload(dave.id, { file_name: "a.pdf", size: 10, content_type: "application/pdf" })).toMatchObject({ ok: true });
    expect(await issueProofUpload(dave.id, { file_name: "b.pdf", size: 10, content_type: "application/pdf" })).toMatchObject({
      ok: false,
      status: 429,
      code: "rate_limited",
    });
  });
});
