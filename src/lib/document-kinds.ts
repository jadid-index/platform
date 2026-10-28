// Document kinds the extraction can report (SPEC section 4) and which kinds fit which achievement type.
// Used by the form for a warning only; it never blocks a submission.

export const DOCUMENT_KINDS = [
  "certificate",
  "diploma",
  "journal_article",
  "conference_programme",
  "patent_or_registration",
  "award_letter",
  "other",
] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

// Keyed by achievement_types.id from docs/seed.sql (the "Type vs document kind" table in SPEC section 4).
export const EXPECTED_KINDS: Record<number, readonly DocumentKind[]> = {
  1: ["journal_article"], // Journal article
  2: ["conference_programme", "certificate", "journal_article"], // Conference paper or abstract
  3: ["certificate", "diploma", "award_letter"], // Olympiad
  4: ["patent_or_registration"], // Patent
  5: ["patent_or_registration"], // Software registration
  6: ["other", "award_letter", "certificate"], // Startup project
  7: ["award_letter", "certificate"], // Grant received
  8: ["certificate", "diploma", "award_letter"], // Hackathon
  9: ["certificate", "award_letter"], // Volunteering
  10: ["certificate", "award_letter"], // Leadership
  11: ["certificate", "award_letter"], // Course
  12: ["other"], // Book challenge
};

export function kindFitsType(kind: string, typeId: number): boolean {
  const expected = EXPECTED_KINDS[typeId];
  return !expected || (expected as readonly string[]).includes(kind);
}
