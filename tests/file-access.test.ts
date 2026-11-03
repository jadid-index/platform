import { describe, expect, it } from "vitest";

import { canViewFile, type FileSubject, type FileViewer } from "@/lib/file-access";
import { FILE_VISIBILITIES } from "@/lib/types";

import { expected, VIEWERS, type ViewerName } from "./file-access-table";

// The pure rule behind GET /api/files and the "View document" link. No database.
const OWNER_ID = "00000000-0000-4000-8000-000000000001";
function fakeViewer(name: ViewerName): FileViewer {
  const user = (id: string, role: "student" | "reviewer" | "employer" | "admin", verifiedEmployer = false): FileViewer => ({
    kind: "user",
    id,
    role,
    active: true,
    verifiedEmployer,
  });
  switch (name) {
    case "anonymous":
      return { kind: "anonymous" };
    case "otherStudent":
      return user("00000000-0000-4000-8000-000000000002", "student");
    case "employer":
      return user("00000000-0000-4000-8000-000000000003", "employer");
    case "verifiedEmployer":
      return user("00000000-0000-4000-8000-000000000004", "employer", true);
    case "reviewer":
      return user("00000000-0000-4000-8000-000000000005", "reviewer");
    case "admin":
      return user("00000000-0000-4000-8000-000000000006", "admin");
    case "owner":
      return user(OWNER_ID, "student");
  }
}

describe("canViewFile()", () => {
  it("every visibility x viewer x sensitive flag matches the table", () => {
    for (const visibility of FILE_VISIBILITIES) {
      for (const flagged of [false, true]) {
        for (const viewer of VIEWERS) {
          const subject: FileSubject = { student_id: OWNER_ID, file_visibility: visibility, sensitive_data_flag: flagged };
          expect(canViewFile(subject, fakeViewer(viewer)), `${visibility} flagged=${flagged} ${viewer}`).toBe(
            expected(viewer, visibility, flagged),
          );
        }
      }
    }
  });

  it("inactive staff and inactive verified employers lose their extra access; the owner keeps it", () => {
    const subject: FileSubject = { student_id: OWNER_ID, file_visibility: "verified", sensitive_data_flag: false };
    for (const role of ["reviewer", "admin"] as const) {
      expect(canViewFile(subject, { kind: "user", id: "x", role, active: false, verifiedEmployer: false })).toBe(false);
    }
    expect(canViewFile(subject, { kind: "user", id: "x", role: "employer", active: false, verifiedEmployer: true })).toBe(false);
    expect(canViewFile(subject, { kind: "user", id: OWNER_ID, role: "student", active: false, verifiedEmployer: false })).toBe(true);
    // Signed in without a profile is like signed out.
    expect(canViewFile(subject, { kind: "user", id: "x", role: null, active: false, verifiedEmployer: false })).toBe(false);
  });
});

