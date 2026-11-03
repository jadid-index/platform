# Consent notice v2 and privacy policy

> **PLACEHOLDER: the team will replace this file with the final text.**
> Until then the app shows a draft from `src/i18n/uz.ts` (`t.consent`, `t.privacy`) and `src/i18n/ru.ts`,
> marked as a draft on the sign-up step and on /privacy. Do not launch with the draft.

When the final text arrives:
1. Paste the Uzbek text into `t.consent.text` / `t.privacy` in `src/i18n/uz.ts`, and the Russian text into `src/i18n/ru.ts`.
2. Set `draft: false` in all four sections.
3. If the text changes after accounts have consented to it, bump `CONSENT_VERSION` in `src/lib/consent.ts`.

## What v2 must cover (decided, 6 Nov)
- Public: name, university, faculty, tier (not points), number of approved works, and for each approved work its title,
  type, issuer, date, level, result, certificate reference and a "verified" mark; the photo if uploaded.
- Never public: email, course, exact points.
- Documents: always visible to the owner, reviewers and admins. Per approved work the student chooses private,
  verified employers (default) or public. Public needs the student's confirmation that the file shows no sensitive data.
  A reviewer's sensitive-data flag keeps the file private for good.
- Signed links valid for 60 seconds, no indexing.
- A hash of the IP address is kept for one day for rate limiting (the raw IP is not stored).
- Servers outside Uzbekistan; the AI text recognition service receives only the document.
- Deletion on request by email.

## Uzbek (Latin)
_Final text goes here._

## Русский
_Окончательный текст будет здесь._
