import { beforeAll, describe, expect, it } from "vitest";

import { approveSubmission, setFileVisibility } from "@/lib/db";

import {
  createTestReviewer,
  createTestStudent,
  fields,
  rubricChoices,
  samplePdf,
  submitThroughApiPath,
  type TestUser,
} from "../../scripts/lib/test-data";
import { testRun } from "../helpers";
import { sessionCookie } from "./session";

// Runs against a live app (next start):  E2E_BASE_URL=http://localhost:3100 npm run test:e2e
// GET /api/files headers and redirect, and the public work page for signed-out and signed-in viewers.
const BASE = process.env.E2E_BASE_URL;
const local = testRun("e2efile");

describe.skipIf(!BASE)("files on the live app", () => {
  let owner: TestUser;
  let reviewer: TestUser;
  const ids: Record<"public" | "verified", string> = { public: "", verified: "" };
  let ownerCookie = "";

  beforeAll(async () => {
    [owner, reviewer] = await Promise.all([
      createTestStudent(local("owner"), "E2E File Owner", 2, { confirmed: true }),
      createTestReviewer(local("reviewer"), "E2E File Reviewer"),
    ]);
    ownerCookie = await sessionCookie(owner);
    const simple = (await rubricChoices()).rows.find((r) => !r.certificate_ref_required)!;
    for (const label of ["public", "verified"] as const) {
      const { created } = await submitThroughApiPath(
        owner.id,
        fields({ type_id: simple.type_id, level: simple.level, result: simple.result, achievement_date: "2025-10-15", title: `[TEST] e2e ${label}` }),
        { bytes: samplePdf(`${local("")}${label}`), name: "proof.pdf", contentType: "application/pdf" },
      );
      if (!created?.ok) throw new Error(JSON.stringify(created));
      ids[label] = created.id;
      const r = await approveSubmission(created.id, reviewer.id, simple.type_id, simple.level, simple.result);
      if (!r.ok) throw new Error(r.message);
    }
    const v = await setFileVisibility(owner.id, ids.public, "public", true);
    if (!v.ok) throw new Error(v.message);
  });

  const get = (path: string, cookie?: string) => fetch(`${BASE}${path}`, { redirect: "manual", headers: cookie ? { cookie } : {} });

  it("a public file redirects to a short-lived signed URL with noindex; the URL carries no student id", async () => {
    const res = await get(`/api/files/${ids.public}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toContain("no-store");
    const location = res.headers.get("location")!;
    expect(location).toContain(`${ids.public}/document.pdf`);
    expect(location).not.toContain(owner.id);
    // The signed URL works right away.
    expect((await fetch(location)).status).toBe(200);
  });

  it("a verified-only file is 404 when signed out and 302 for the owner", async () => {
    const anon = await get(`/api/files/${ids.verified}`);
    expect(anon.status).toBe(404);
    expect(anon.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await get(`/api/files/${ids.verified}`, ownerCookie)).status).toBe(302);
  });

  it("the work page shows the document link only to allowed viewers", async () => {
    const pub = await (await get(`/works/${ids.public}`)).text();
    expect(pub).toContain(`/api/files/${ids.public}`);
    expect(pub).toContain("[TEST] e2e public");

    const anon = await (await get(`/works/${ids.verified}`)).text();
    expect(anon).toContain("[TEST] e2e verified");
    expect(anon).not.toContain(`/api/files/${ids.verified}`);

    const mine = await (await get(`/works/${ids.verified}`, ownerCookie)).text();
    expect(mine).toContain(`/api/files/${ids.verified}`);
  });
});
