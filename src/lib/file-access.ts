import type { FileVisibility } from "@/lib/types";

// Who may open an approved work's document (CLAUDE.md rule 4). Pure, so the route, the pages and the tests share it.
//   owner, reviewer, admin: always
//   sensitive_data_flag:    nobody else
//   public:                 anyone, signed out too
//   verified:               employers whose employer_profiles.verified = true
//   private:                nobody else
// Pending, rejected and withdrawn submissions never hand out a file; the caller checks the status first.

export const FILE_URL_SECONDS = 60; // lifetime of the signed URL behind /api/files/:id
export const FILE_REQUESTS_PER_WINDOW = 30; // per user, or per hashed IP when signed out
export const FILE_WINDOW_MINUTES = 10;

// The only URL the app ever shows for a document.
export const fileHref = (submissionId: string) => `/api/files/${submissionId}`;

export type FileViewer =
  | { kind: "anonymous" }
  | {
      kind: "user";
      id: string;
      role: "student" | "reviewer" | "employer" | "admin" | null; // null: signed in without a profile
      active: boolean;
      verifiedEmployer: boolean;
    };

export type FileSubject = { student_id: string; file_visibility: FileVisibility; sensitive_data_flag: boolean };

export function isFileStaff(viewer: FileViewer, subject: Pick<FileSubject, "student_id">): boolean {
  if (viewer.kind !== "user") return false;
  if (viewer.id === subject.student_id) return true;
  return viewer.active && (viewer.role === "reviewer" || viewer.role === "admin");
}

export function canViewFile(subject: FileSubject, viewer: FileViewer): boolean {
  if (isFileStaff(viewer, subject)) return true;
  if (subject.sensitive_data_flag) return false;
  switch (subject.file_visibility) {
    case "public":
      return true;
    case "verified":
      return viewer.kind === "user" && viewer.active && viewer.role === "employer" && viewer.verifiedEmployer;
    default:
      return false;
  }
}
