// Version of the consent notice the student agrees to. It is stored in profiles.consent_version.
// v2 (6 Nov): file visibility, issuer and certificate reference public, tiers instead of points, hashed IP log.
// v3 (7 Nov): the opt-in talent directory for employers and contact requests (contact shared only on accept).
// v4 (8 Nov): the in-app CV (private by default; verified employers or public by choice; accepted employers see
// its contact fields; never sent to the AI model).
// v5 (9 Nov): the uploaded CV file (PDF; same visibility as the CV; public means anyone may download it; kept until
// replaced or deleted; unfinished uploads removed after an hour; downloads by employers and admins logged).
// The text is t.consent in src/i18n/uz.ts and src/i18n/ru.ts. It is still a DRAFT (t.consent.draft): the team's
// final text from docs/consent-v2.md replaces it. Bump this whenever the text changes; /api/profile accepts only
// the current version. Existing accounts are not asked to consent again.
export const CONSENT_VERSION = "v5";

// Version of the acceptable-use notice an employer agrees to at onboarding (t.employerTerms, DRAFT).
// Stored in profiles.consent_version of the employer's profile.
export const EMPLOYER_TERMS_VERSION = "employer-v1";
