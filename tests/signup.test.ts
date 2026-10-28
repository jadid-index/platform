import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import { CONSENT_VERSION } from "@/lib/consent";
import { createStudentProfile, listUniversitiesWithFaculties } from "@/lib/db";
import { safeNextPath } from "@/lib/redirect";
import { getAdminClient } from "@/lib/supabase/admin";
import { profileBodySchema, submissionBodySchema } from "@/lib/validation";

import { createTestAuthUser } from "../scripts/lib/test-data";
import { testRun } from "./helpers";

const local = testRun("su");

async function profileBody(extra: Record<string, unknown> = {}) {
  const university = (await listUniversitiesWithFaculties()).find((u) => u.faculties.length > 0)!;
  return {
    full_name: "TEST Ochiq Royxat",
    university_id: university.id,
    faculty_id: university.faculties[0].id,
    course: 1,
    consent_version: CONSENT_VERSION,
    ...extra,
  };
}

describe("sign-up (open pilot, CLAUDE.md rule 6)", () => {
  it("creates an active student profile for any domain without email verification", async () => {
    // example.invalid is not in allowed_email_domains, and the email is not confirmed.
    const user = await createTestAuthUser(local("any"));
    const { data: auth } = await getAdminClient().auth.admin.getUserById(user.id);
    expect(auth.user?.email_confirmed_at ?? null).toBeNull();

    // Same parsing as POST /api/profile: privileged columns in the body are dropped.
    const parsed = profileBodySchema.parse(
      await profileBody({ role: "admin", status: "rejected", id: crypto.randomUUID(), photo_path: "x.png" }),
    );
    expect(Object.keys(parsed).sort()).toEqual(["consent_version", "course", "faculty_id", "full_name", "university_id"]);
    expect(await createStudentProfile(user.id, parsed)).toEqual({ ok: true });

    const { data } = await getAdminClient().from("profiles").select("id, role, status, photo_path, consent_at").eq("id", user.id).single();
    expect(data).toMatchObject({ id: user.id, role: "student", status: "active", photo_path: null });
    expect(data!.consent_at).not.toBeNull();
  });

  it("allows only one profile per user", async () => {
    const user = await createTestAuthUser(local("once"));
    const body = profileBodySchema.parse(await profileBody());
    expect(await createStudentProfile(user.id, body)).toEqual({ ok: true });
    expect(await createStudentProfile(user.id, body)).toEqual({ ok: false, reason: "exists" });
  });

  it("drops privileged fields from the submission body too", () => {
    const parsed = submissionBodySchema.parse({
      submission_id: crypto.randomUUID(),
      file_name: "a.pdf",
      upload_ticket: "t",
      type_id: 1,
      level: "national",
      title: "Title",
      issuer: "Issuer",
      achievement_date: "2025-01-01",
      student_id: crypto.randomUUID(),
      status: "approved",
      file_path: "someone/else.pdf",
      file_sha256: "0",
      points: 100,
    });
    for (const key of ["student_id", "status", "file_path", "file_sha256", "points"]) expect(parsed).not.toHaveProperty(key);
  });
});

describe("publishable key (what any visitor can call)", () => {
  const anon = () =>
    createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false },
    });
  const zero = "00000000-0000-0000-0000-000000000000";

  // Needs migration 20261025000000_lock_down_rpc_and_views.sql.
  it("cannot call approve_submission() or reject_submission()", async () => {
    const a = await anon().rpc("approve_submission", { p_submission: zero, p_reviewer: zero, p_type: 1, p_level: "national", p_result: "confirmed" });
    const r = await anon().rpc("reject_submission", { p_submission: zero, p_reviewer: zero, p_reason: "x" });
    expect(a.error?.code).toBe("42501");
    expect(r.error?.code).toBe("42501");
  });

  it("cannot read the leaderboard views directly", async () => {
    for (const view of ["leaderboard", "leaderboard_by_year", "public_works"]) {
      const { error } = await anon().from(view).select("*").limit(1);
      expect(error?.code, view).toBe("42501");
    }
  });

  it("reads no rows from private tables", async () => {
    for (const table of ["profiles", "submissions", "reviews", "audit_log", "app_settings", "allowed_email_domains"]) {
      const { data } = await anon().from(table).select("*").limit(1);
      expect(data ?? [], table).toEqual([]);
    }
  });
});

describe("safeNextPath (OAuth callback)", () => {
  it("keeps same-site paths and drops everything else", () => {
    expect(safeNextPath("/dashboard")).toBe("/dashboard");
    expect(safeNextPath("/students/x?y=1")).toBe("/students/x?y=1");
    for (const bad of ["//evil.com", "/\\evil.com", "/\t/evil.com", "/\n/evil.com", "https://evil.com", "evil", "", null]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });
});
