# Jadid Index - Platform

MVP of a national platform that ranks university students by recognized achievements.
Pilot: International Islamic Academy of Uzbekistan (IIAU). First demo: Thursday.

Read `docs/SPEC.md` before building anything. It has the endpoints, validation, the AI extraction prompt
and the build order. `docs/schema.sql` and `docs/seed.sql` are the source of truth for the database.
The rubric lives in `docs/jadid_index_rubric_v0.3.xlsx`; `seed.sql` is generated from it, never edit points by hand.

## Stack and deployment

- Next.js (App Router, TypeScript), Tailwind, a component library (shadcn/ui).
- Supabase: Postgres, Auth, Storage. Hosted for now; the team confirmed hosting abroad is acceptable for the pilot.
  Keep it portable, because a move to local hosting may be needed later (see "Portability").
- Deploy: Vercel, imported from GitLab. Environment variables live in Vercel and Supabase, never in the repo.
- Put the schema in `supabase/migrations/` as the first migration (copy of `docs/schema.sql`), then the seed.

## Rules that must never be broken

1. **Points come only from the `rubric_points` table.** Approval goes through the `approve_submission()` SQL function,
   which applies the yearly category cap. Never compute or store points anywhere else.
2. **AI never decides anything.** It extracts fields and suggests values. The student confirms the form, and a human
   reviewer approves or rejects. AI output is saved in `ai_extraction` / `ai_flags` for the reviewer to see.
3. **The browser never writes to the database.** All writes go through server route handlers using the service-role key.
   The service-role key and the AI API key exist only on the server and must never be imported into client code.
4. **Uploaded proof files are private.** Store them in the private `proofs` bucket and give reviewers short-lived
   signed URLs. Never show a file or a file URL on the leaderboard or on a public profile.
5. **Public data is limited** to name, faculty, score, approved work titles and (if uploaded) the profile photo.
   That is exactly what the consent notice promises. Do not add anything else to public views.
6. **Sign-up needs a verified email on an allowed domain** (`allowed_email_domains`, currently `iiau.uz`).
   A database trigger enforces it. Do not bypass it, and keep email verification switched on in Supabase Auth.
7. **A rejection needs a reason.** Reviewers cannot review their own submissions.
8. **Never commit secrets.** `.env*` stays in `.gitignore`; keep `.env.example` with variable names only.
9. **Never send student profile data to the AI model.** `/api/extract` sends the document and the prompt only.

## UI

- Language: Uzbek (Latin) is the default. Put all text in a translations file so Russian and English can be added.
- Mobile first. Students will use phones. Test every screen at 375 px wide.
- Colors: a soft pastel palette with **green as the primary color**. No blue or gold branding.
  Define the palette once as Tailwind theme tokens (primary, primary-soft, surface, border, text, muted, plus status colors).
  No hard-coded hex values in components.
  - Primary: sage / mint green. Buttons and active states use the primary token with dark enough text to pass
    WCAG AA contrast (4.5:1). Pastel fills are for backgrounds and chips, not for small text.
  - Neutrals: warm off-white surfaces, soft grey-green borders, a dark green-grey for text (never pure black).
  - Status colors are pastel too, and every status also shows a label or icon, never color alone:
    Pending = soft amber, Approved = green, Rejected = soft rose.
  - Support light mode only for Thursday.
- Use the component library. Do not build custom form controls for Thursday.
- Every list and screen needs a loading state, an empty state and an error state.
- Most important screens, in this order: leaderboard, reviewer review screen, add achievement, student dashboard, sign-up.
- Leaderboard defaults to the current academic year (1 September start), with tabs for earlier years and all-time,
  and filters for university and faculty. Sort by points, ties broken by the earlier approval date.

## Working agreements

- Language of code and comments: English.
- One owner for `schema.sql` and migrations. Ask before changing the schema, and add a new migration instead of
  editing an applied one.
- Validate every request body on the server (zod), whatever the form already checks.
- Keep scope tight. For Thursday, cut these first: photo and bio, appeal comment, extra recognition checks.
  Do not build: blockchain, plagiarism detection, quality scoring, admin screens, notifications.
- Commit small and often. Open merge requests against `main`; during the Thursday sprint pushing directly is fine.

## Portability (so a move to local hosting stays cheap)

- Use Supabase only for Auth, Storage and Postgres. No Edge Functions, no Realtime for core features.
- Access the database and storage through one small server-side module, not scattered across components.
- Keep all business rules in SQL functions or server route handlers, not in client code.

## Commands

Fill these in after the project is scaffolded:

- Install: `npm install`
- Dev server: `npm run dev`
- Type check and lint: `npm run lint` and `npx tsc --noEmit`
- Tests: `npm test` (add tests at least for the approve/reject flow and the leaderboard query)

## Open items (do not guess, ask the team)

- The exact consent notice text (Uzbek, Russian) and its version string.
- Whether `student.iiau.uz` or other subdomains also need to be allowed.
- The list of first reviewers (accounts are created by hand in the database for now).
