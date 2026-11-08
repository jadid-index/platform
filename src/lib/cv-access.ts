import type { FileViewer } from "@/lib/file-access";
import type { CvVisibility } from "@/lib/types";

// Who may open a student's CV, and what they see (CLAUDE.md rule 12). Pure, so the route, the pages and the tests
// share it. The server strips what a viewer may not see before anything is rendered or returned.
//
//   viewer \ cv_visibility                    private        verified                public
//   owner (any status)                        full           full                    full
//   active admin                              full, logged   full, logged            full, logged
//   employer with an accepted request         full, logged   full, logged            full, logged
//   verified employer                         404            no contacts, logged     no contacts, logged
//   unverified employer                       404            404                     public view, logged
//   anyone else (student, reviewer, signed out) 404          404                     public view
//
// "full" = with the CV contact fields and the course. "public view" = without both (rule 5: course is never public).
// A student who is not active is a 404 for everyone except the owner and admins (the kill switch, rule 6).

export type CvViewer =
  | { kind: "anonymous" }
  | (Extract<FileViewer, { kind: "user" }> & {
      // An accepted contact request from this employer to the student (looked up only for employers).
      acceptedRequest: boolean;
    });

export type CvSubject = { student_id: string; student_active: boolean; visibility: CvVisibility };

export type CvAccess = { contacts: boolean; course: boolean; log: "admin" | "employer" | null };

const FULL = { contacts: true, course: true } as const;

export function cvAccess(subject: CvSubject, viewer: CvViewer): CvAccess | null {
  if (viewer.kind === "user" && viewer.id === subject.student_id) return { ...FULL, log: null };
  const user = viewer.kind === "user" && viewer.active ? viewer : null;
  if (user?.role === "admin") return { ...FULL, log: "admin" };
  if (!subject.student_active) return null;

  if (user?.role === "employer") {
    if (user.acceptedRequest) return { ...FULL, log: "employer" };
    if (subject.visibility === "public" || (subject.visibility === "verified" && user.verifiedEmployer)) {
      return { contacts: false, course: user.verifiedEmployer, log: "employer" };
    }
    return null;
  }
  if (subject.visibility === "public") return { contacts: false, course: false, log: null };
  return null;
}
