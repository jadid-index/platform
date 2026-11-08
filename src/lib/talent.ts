import "server-only";

import { requireTalentViewer } from "@/lib/auth";
import { cvAvailableFor } from "@/lib/cv";
import { getTalentStudent, isVerifiedEmployer, listTalent, logEmployerProfileView } from "@/lib/db";
import type { FileViewer } from "@/lib/file-access";
import type { TalentList, TalentStudent } from "@/lib/types";
import type { TalentQuery } from "@/lib/validation";

// Global safeguard for contact requests across all employers in 24 hours (CONTACT_REQUESTS_DAILY_CAP, default 300).
export function contactRequestsDailyCap(): number {
  const n = Number(process.env.CONTACT_REQUESTS_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : 300;
}

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

type TalentViewer = { userId: string; role: "employer" | "admin" };

async function withVerified(viewer: TalentViewer) {
  return { ...viewer, verifiedEmployer: viewer.role === "employer" ? await isVerifiedEmployer(viewer.userId) : false };
}

// One page of the directory, with whether this viewer may open each student's CV ("Open CV" link).
export async function loadTalentList(viewer: TalentViewer, query: TalentQuery): Promise<TalentList> {
  const [page, v] = await Promise.all([listTalent(query), withVerified(viewer)]);
  const cv = await cvAvailableFor(v, page.rows.map((r) => r.student_id));
  return { ...page, rows: page.rows.map((r) => ({ ...r, cv_available: cv.has(r.student_id) })) };
}

// One student of the directory for an active employer or admin, shared by GET /api/talent/:id and /talent/[studentId].
// An employer's view is logged in audit_log (employer, student, time); admins are not logged.
export async function loadTalentStudent(viewer: TalentViewer, studentId: string): Promise<TalentStudent | null> {
  const v = await withVerified(viewer);
  const fileViewer: FileViewer & { kind: "user" } = {
    kind: "user",
    id: viewer.userId,
    role: viewer.role,
    active: true,
    verifiedEmployer: v.verifiedEmployer,
  };
  const student = await getTalentStudent(studentId, fileViewer);
  if (!student) return null;
  if (viewer.role === "employer") await logEmployerProfileView(viewer.userId, studentId, "talent");
  const cv = await cvAvailableFor(v, [studentId]);
  return { ...student, cv_available: cv.has(studentId) };
}

export { requireTalentViewer };
