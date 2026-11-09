import "server-only";

import { cvAccess, type CvViewer } from "@/lib/cv-access";
import {
  cvContacts,
  cvContent,
  getCvAvailabilityParts,
  getCvFileOwners,
  getCvParts,
  getCurrentCvFile,
  getCvVerified,
  hasAcceptedRequest,
  logCvFileDownload,
  logCvView,
} from "@/lib/db";
import type { FileViewer } from "@/lib/file-access";
import type { CvView } from "@/lib/types";

// Response headers for every CV read: never cached, never indexed.
export const CV_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" } as const;

// Headers of GET /api/cv/:id/file (the redirect and its errors).
export const CV_FILE_HEADERS = {
  ...CV_HEADERS,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

async function toCvViewer(viewer: FileViewer, studentId: string): Promise<CvViewer> {
  if (viewer.kind !== "user") return viewer;
  const employer = viewer.active && viewer.role === "employer";
  return { ...viewer, acceptedRequest: employer ? await hasAcceptedRequest(viewer.id, studentId) : false };
}

// One CV as this viewer may see it, or null (the caller answers 404). The contacts and the course are left out of
// the object unless cvAccess() allows them. Employer and admin views are written to audit_log.
// Only the owner sees a CV that was never saved; for everyone else it does not exist yet.
export async function loadCvForViewer(studentId: string, viewer: FileViewer, page: "cv" | "print" | "api"): Promise<CvView | null> {
  const parts = await getCvParts(studentId);
  if (!parts) return null;
  const { student, cv } = parts;
  const isOwner = viewer.kind === "user" && viewer.id === studentId;
  if (!cv && !isOwner) return null;

  const access = cvAccess(
    { student_id: studentId, student_active: student.active, visibility: cv?.cv_visibility ?? "private" },
    await toCvViewer(viewer, studentId),
  );
  if (!access) return null;

  const { tier, works } = await getCvVerified(studentId);
  if (access.log && viewer.kind === "user") await logCvView(viewer.id, access.log, studentId, page);

  return {
    student_id: student.student_id,
    full_name: student.full_name,
    university: student.university,
    faculty: student.faculty,
    ...(access.course && student.course != null ? { course: student.course } : {}),
    tier,
    content: cvContent(cv),
    ...(access.contacts ? { contacts: cvContacts(cv) } : {}),
    works,
    updated_at: cv?.updated_at ?? null,
  };
}

// For /talent: the students (all active and open to work) whose typed CV (cv) and uploaded CV file (file) this
// employer or admin may open. The file follows the same cv_visibility; a student without a CV row is 'private'.
export async function cvAvailableFor(
  viewer: { userId: string; role: "employer" | "admin"; verifiedEmployer: boolean },
  studentIds: string[],
): Promise<{ cv: Set<string>; file: Set<string> }> {
  const [{ visibility, accepted }, owners] = await Promise.all([
    getCvAvailabilityParts(viewer.role === "employer" ? viewer.userId : null, studentIds),
    getCvFileOwners(studentIds),
  ]);
  const cv = new Set<string>();
  const file = new Set<string>();
  for (const id of studentIds) {
    const v = visibility.get(id);
    if (!v && !owners.has(id)) continue;
    const access = cvAccess(
      { student_id: id, student_active: true, visibility: v ?? "private" },
      {
        kind: "user",
        id: viewer.userId,
        role: viewer.role,
        active: true,
        verifiedEmployer: viewer.verifiedEmployer,
        acceptedRequest: accepted.has(id),
      },
    );
    if (!access) continue;
    if (v) cv.add(id);
    if (owners.has(id)) file.add(id);
  }
  return { cv, file };
}

// The storage object of the student's uploaded CV, if this viewer may download it; otherwise null (the route answers
// 404). Same matrix as the typed CV (cvAccess()): the file shares cv_visibility, and a student without a CV row
// counts as 'private'. Not active students: owner and admins only. Employer and admin downloads go to audit_log.
// Server only: the object name never leaves the server; the route turns it into a 60-second signed URL.
export async function cvFileObjectForViewer(studentId: string, viewer: FileViewer): Promise<string | null> {
  const parts = await getCvParts(studentId);
  if (!parts) return null;
  const file = await getCurrentCvFile(studentId);
  if (!file) return null;
  const access = cvAccess(
    { student_id: studentId, student_active: parts.student.active, visibility: parts.cv?.cv_visibility ?? "private" },
    await toCvViewer(viewer, studentId),
  );
  if (!access) return null;
  if (access.log && viewer.kind === "user") await logCvFileDownload(viewer.id, access.log, studentId);
  return file.object_name;
}
