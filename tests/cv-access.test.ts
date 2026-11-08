import { describe, expect, it } from "vitest";

import { cvAccess, type CvViewer } from "@/lib/cv-access";
import { CV_VISIBILITIES, type CvVisibility } from "@/lib/types";

// The CV access matrix (CLAUDE.md rule 12), written out by hand and checked against cvAccess().
// "full" = contacts and course; "noContacts" = course but no contacts; "public" = neither; null = 404.
type Seen = "full" | "noContacts" | "public" | null;

const OWNER = "00000000-0000-4000-8000-000000000001";

const VIEWERS: Record<string, CvViewer> = {
  anonymous: { kind: "anonymous" },
  owner: { kind: "user", id: OWNER, role: "student", active: true, verifiedEmployer: false, acceptedRequest: false },
  otherStudent: { kind: "user", id: "s2", role: "student", active: true, verifiedEmployer: false, acceptedRequest: false },
  reviewer: { kind: "user", id: "r1", role: "reviewer", active: true, verifiedEmployer: false, acceptedRequest: false },
  admin: { kind: "user", id: "a1", role: "admin", active: true, verifiedEmployer: false, acceptedRequest: false },
  employer: { kind: "user", id: "e1", role: "employer", active: true, verifiedEmployer: false, acceptedRequest: false },
  verifiedEmployer: { kind: "user", id: "e2", role: "employer", active: true, verifiedEmployer: true, acceptedRequest: false },
  acceptedEmployer: { kind: "user", id: "e3", role: "employer", active: true, verifiedEmployer: false, acceptedRequest: true },
  hiddenAdmin: { kind: "user", id: "a2", role: "admin", active: false, verifiedEmployer: false, acceptedRequest: false },
  hiddenAcceptedEmployer: { kind: "user", id: "e4", role: "employer", active: false, verifiedEmployer: true, acceptedRequest: true },
  noProfile: { kind: "user", id: "n1", role: null, active: false, verifiedEmployer: false, acceptedRequest: false },
};

const MATRIX: Record<string, Record<CvVisibility, Seen>> = {
  anonymous: { private: null, verified: null, public: "public" },
  owner: { private: "full", verified: "full", public: "full" },
  otherStudent: { private: null, verified: null, public: "public" },
  reviewer: { private: null, verified: null, public: "public" },
  admin: { private: "full", verified: "full", public: "full" },
  employer: { private: null, verified: null, public: "public" },
  verifiedEmployer: { private: null, verified: "noContacts", public: "noContacts" },
  acceptedEmployer: { private: "full", verified: "full", public: "full" },
  // A viewer whose own account is not active counts as signed out.
  hiddenAdmin: { private: null, verified: null, public: "public" },
  hiddenAcceptedEmployer: { private: null, verified: null, public: "public" },
  noProfile: { private: null, verified: null, public: "public" },
};

function seen(visibility: CvVisibility, viewer: CvViewer, studentActive = true): Seen {
  const a = cvAccess({ student_id: OWNER, student_active: studentActive, visibility }, viewer);
  if (!a) return null;
  if (a.contacts && a.course) return "full";
  if (!a.contacts && a.course) return "noContacts";
  if (!a.contacts && !a.course) return "public";
  throw new Error("contacts without course is not a state the matrix allows");
}

describe("cvAccess() matrix", () => {
  for (const [name, viewer] of Object.entries(VIEWERS)) {
    for (const v of CV_VISIBILITIES) {
      it(`${name} × ${v}`, () => expect(seen(v, viewer)).toBe(MATRIX[name][v]));
    }
  }

  it("contacts are never given to anyone but the owner, admins and accepted employers", () => {
    for (const [name, viewer] of Object.entries(VIEWERS)) {
      for (const v of CV_VISIBILITIES) {
        const a = cvAccess({ student_id: OWNER, student_active: true, visibility: v }, viewer);
        if (a?.contacts) expect(["owner", "admin", "acceptedEmployer"]).toContain(name);
      }
    }
  });

  it("a student who is not active: only the owner and admins", () => {
    for (const [name, viewer] of Object.entries(VIEWERS)) {
      for (const v of CV_VISIBILITIES) {
        const expected = name === "owner" || name === "admin" ? "full" : null;
        expect(seen(v, viewer, false), `${name} × ${v}`).toBe(expected);
      }
    }
  });

  it("logs admin and employer views, never the owner or anonymous views", () => {
    const at = (viewer: CvViewer) => cvAccess({ student_id: OWNER, student_active: true, visibility: "public" }, viewer)?.log;
    expect(at(VIEWERS.admin)).toBe("admin");
    expect(at(VIEWERS.employer)).toBe("employer");
    expect(at(VIEWERS.verifiedEmployer)).toBe("employer");
    expect(at(VIEWERS.acceptedEmployer)).toBe("employer");
    expect(at(VIEWERS.owner)).toBeNull();
    expect(at(VIEWERS.anonymous)).toBeNull();
    expect(at(VIEWERS.otherStudent)).toBeNull();
  });
});
