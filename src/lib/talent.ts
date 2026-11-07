import "server-only";

import { requireTalentViewer } from "@/lib/auth";
import { getTalentStudent, isVerifiedEmployer, logEmployerProfileView } from "@/lib/db";
import type { FileViewer } from "@/lib/file-access";
import type { TalentStudent } from "@/lib/types";

// Global safeguard for contact requests across all employers in 24 hours (CONTACT_REQUESTS_DAILY_CAP, default 300).
export function contactRequestsDailyCap(): number {
  const n = Number(process.env.CONTACT_REQUESTS_DAILY_CAP);
  return Number.isInteger(n) && n >= 0 ? n : 300;
}

export const NO_STORE = { "Cache-Control": "private, no-store" } as const;

// One student of the directory for an active employer or admin, shared by GET /api/talent/:id and /talent/[studentId].
// An employer's view is logged in audit_log (employer, student, time); admins are not logged.
export async function loadTalentStudent(
  viewer: { userId: string; role: "employer" | "admin" },
  studentId: string,
): Promise<TalentStudent | null> {
  const fileViewer: FileViewer & { kind: "user" } = {
    kind: "user",
    id: viewer.userId,
    role: viewer.role,
    active: true,
    verifiedEmployer: viewer.role === "employer" ? await isVerifiedEmployer(viewer.userId) : false,
  };
  const student = await getTalentStudent(studentId, fileViewer);
  if (student && viewer.role === "employer") await logEmployerProfileView(viewer.userId, studentId, "talent");
  return student;
}

export { requireTalentViewer };
