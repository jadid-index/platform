import type { FileVisibility } from "@/lib/types";

// The expected table, written out independently of canViewFile().
export const VIEWERS = ["anonymous", "otherStudent", "employer", "verifiedEmployer", "reviewer", "admin", "owner"] as const;
export type ViewerName = (typeof VIEWERS)[number];
const STAFF: ViewerName[] = ["owner", "reviewer", "admin"];

export function expected(viewer: ViewerName, visibility: FileVisibility, flagged: boolean): boolean {
  if (STAFF.includes(viewer)) return true;
  if (flagged) return false;
  if (visibility === "public") return true;
  if (visibility === "verified") return viewer === "verifiedEmployer";
  return false;
}

