# Jadid Index - Platform

MVP of a national platform that ranks university students by recognized achievements.
Pilot: International Islamic Academy of Uzbekistan (IIAU). First demo: Thursday.

Read `docs/SPEC.md` before building anything. It has the endpoints, validation, the AI extraction prompt
and the build order. `docs/schema.sql` and `docs/seed.sql` are the source of truth for the database.
The rubric started in the v0.3 workbook (in the repo as `docs/rubric.xlsx`); `seed.sql` was generated from it and both
stay as the original seed. **After the first edit on `/admin/rubric`, the database is the source of truth for the rubric**;
do not regenerate or re-run the seed against a live database, and never edit points by hand in SQL.

## Stack and deployment

- Next.js (App Router, TypeScript), Tailwind, a component library (shadcn/ui).
- Supabase: Postgres, Auth, Storage. Hosted for now; the team confirmed hosting abroad is acceptable for the pilot.
  Keep it portable, because a move to local hosting may be needed later (see "Portability").
- Deploy: Vercel, imported from GitHub. Environment variables live in Vercel and Supabase, never in the repo.
- Put the schema in `supabase/migrations/` as the first migration (copy of `docs/schema.sql`), then the seed.

## Rules that must never be broken

1. **Points come only from the `rubric_points` table.** Approval goes through the `approve_submission()` SQL function,
   which applies the yearly category cap. Never compute or store points anywhere else.
   Admins change types, points and caps only on `/admin/rubric`, through the `admin_*` rubric SQL functions
   (range checks, a required reason, one `audit_log` row per change). Approved reviews keep the points they were given
   (`reviews.rubric_points` / `points_awarded` are snapshots); a rubric change applies to future approvals only.
   Never change an existing review row from a rubric edit. Correcting approved reviews is a separate, later feature.
2. **AI never decides anything.** It extracts fields and suggests values. The student confirms the form, and a human
   reviewer approves or rejects. AI output is saved in `ai_extraction` / `ai_flags` for the reviewer to see.
3. **The browser never writes to the database.** All writes go through server route handlers using the Supabase secret key (`sb_secret_...`).
   The secret key and the AI API key exist only on the server and must never be imported into client code.
   The browser uses only the publishable key (`sb_publishable_...`). Do not use the legacy anon / service_role keys.
4. **Proof files stay in the private `proofs` bucket; visibility decides who may open them.** Object names are
   neutral (`{submission_id}/document.{ext}`, never the student id or the original file name). The only way to a file
   is `GET /api/files/:submissionId`: approved submissions only, rate limited, `X-Robots-Tag: noindex`, and a redirect
   to a signed URL that expires in 60 seconds. Never return a storage path or a long-lived URL in any response.
   `canViewFile()` (`src/lib/file-access.ts`) decides: owner, reviewers and admins always; `submissions.file_visibility`
   'public' anyone (set by the owner only after the confirmation dialog, `public_confirmed_at`), 'verified' employers
   with `employer_profiles.verified = true` (default), 'private' nobody else. A reviewer's `sensitive_data_flag` forces
   private for good. Changes go only through `set_file_visibility()` / `set_sensitive_flag()` (they write `audit_log`).
5. **Public data is limited** to what the consent notice (`t.consent`, version `CONSENT_VERSION`, v4) promises:
   name, university, faculty, tier (never points, rule 11), the number of approved works, and for each approved work
   its title, type, issuer, date, level, result, certificate reference and a verified mark, plus the profile photo
   if the student uploaded one, plus the document only as rule 4 allows. Never the email, course or exact points.
   Do not add anything else to public views; if you must, change the notice and bump its version first.
   The talent directory (`/talent`, signed-in employers and admins only) shows the same public fields, only for
   students who switched on `profiles.open_to_work`. A student's contact detail reaches an employer only when the
   student accepts that employer's contact request and picks which one to share (phone, Telegram or email); it is
   stored on that request only, shown only while the student is active, and never written to `audit_log`.
   That employer can also open the student's CV with its contact fields (rule 12); the accept dialog says so.
   Each employer view of a student profile is logged (`employer.profile_viewed`).
   Google sign-in must not import a profile photo (no avatar_url), and the name from Google is only a
   suggestion that the student confirms, because it is shown publicly.
6. **Pilot sign-up is open: any email address, no email verification** (team decision, 24 Oct, temporary).
   Identity verification (university email, HEMIS / student ID login) comes after the pilot. Keep `profiles.status`,
   `allowed_email_domains` and the student-review idea in the schema, but do not enforce them now, and do not
   build features that assume emails are real or deliverable (no email notifications; password reset by email
   works only if SMTP is configured). A profile with status other than 'active' is hidden from the leaderboard and
   public profiles; that is the kill switch for fake accounts. Admins set status 'hidden' on `/admin/users`.
7. **A rejection needs a reason.** Reviewers cannot review their own submissions.
8. **Never commit secrets.** `.env*` stays in `.gitignore`; keep `.env.example` with variable names only.
9. **Never send student profile data to the AI model.** `/api/extract` sends the document and the prompt only.
10. **Roles are student, reviewer, employer, admin.** A role is only ever set by an admin or by onboarding (student or employer only).
   `POST /api/profile` is strict: only `role: "student" | "employer"`, no extra keys; a role in user metadata is ignored.
   Every /admin route and every role-based action is checked on the server. Student routes (`requireActiveStudent()`)
   refuse employers; employer routes (`requireEmployer()`, `/talent` via `requireTalentViewer()`) refuse students and
   reviewers. `tests/employers.test.ts` scans the route folders for this.
   Employers need no verification to sign up (rule 6). Admins set `employer_profiles.verified` on `/admin/users`
   (`admin_set_employer_verified()`, audit row); verified employers get 30 instead of 10 contact requests a day and
   open 'verified' documents. `CONTACT_REQUESTS_DAILY_CAP` (default 300) caps requests across all employers.
   Role and status changes go only through `admin_set_role()` / `admin_set_status()` (they protect the last admin
   and write `audit_log`). The first admin is created by SQL (`docs/SPEC.md` section 3a); there is no self-promotion.
11. **Public views and public APIs never return points or rank numbers; they return tiers.**
   Exact points go only to the owner, reviewers and admins. The `tiers` table (code, label, min_points, sort_order;
   edited on `/admin/rubric`) and `tier_for(points)` decide the tier: a year view uses that year's points, all-time
   uses the student's best academic year, and no tier ("–") below the lowest threshold. Public order is tier (best
   first), then name; there is no tie-breaking by approval date and no approval-order data in public responses.
   `tests/tiers.test.ts` scans every public route's JSON for point, rank and approval-time keys.
12. **CV data follows the visibility rules: private by default. CV contact details are shown only to an employer with
   an accepted contact request, never on a public view. CVs are never sent to the AI model.**
   One CV per student in `student_cvs` (`docs/SPEC.md` section 3f); writes only through `save_cv()` /
   `set_cv_visibility()` (zod first, the same limits again in SQL, 60 writes an hour, audit rows without CV text).
   `cvAccess()` (`src/lib/cv-access.ts`) decides: owner and admins always (with contacts and course); an employer with
   an accepted request always (with contacts and course); 'verified' also verified employers (course, no contacts);
   'public' anyone (set only after the confirmation dialog, `cv_public_confirmed_at`), without contacts and without
   the course; everyone else 404. A student who is not active: owner and admins only. The server leaves the hidden
   fields out of the data (`loadCvForViewer()` in `src/lib/cv.ts`). Every employer and admin view is logged
   (`employer.cv_viewed`, `admin.cv_viewed`). No CV data in any listing or public API; `/talent` gets only the
   boolean `cv_available`. One disclaimer line marks the typed sections as self-declared; links are https only, rendered with
   `rel="noopener noreferrer nofollow"`. CV pages are `noindex` and never cached. `tests/cv*.test.ts` cover this.

## UI

- Language: Uzbek (Latin) is the default. Put all text in a translations file so Russian and English can be added.
- Mobile first, with a full desktop layout from the lg breakpoint up. Test every screen at 375 px and at 1440 px wide.
- Colors: a theme system. All color values live in `src/styles/themes.css` (one `[data-theme]` block per theme),
  mapped to Tailwind tokens in `src/app/globals.css`; the theme list is `src/lib/themes.ts`. Components use semantic
  tokens only (background, surface, surface-raised, surface-inverse, border, border-strong, text, muted, primary,
  primary-contrast, primary-text, accent, accent-contrast, accent-text, success, warning, danger, tier-*, category-*),
  never hex values or Tailwind palette classes. Adding a theme must not touch any component.
  - "mint" (default, the team palette): page #EFFFFB, primary #50D890, secondary blue #4F98CA, text and dark surfaces #272727.
    Text on #EFFFFB is #272727. Fills of #50D890 or #4F98CA carry #272727 text, never white. Never use #50D890 or
    #4F98CA as text on light surfaces; small green or blue text and links use the derived `primary-text` / `accent-text`
    (same hues, darker, 4.5:1 or more). On #272727 surfaces #50D890 and #4F98CA may be text.
  - "mint" is currently the only theme; the switcher (top bar, profile menu, mobile sheet) is hidden while
    `THEMES` has one entry. The viewer picks a theme there; it is saved in the `jadid-theme` cookie and applied
    before first paint by the script in the root layout (unknown or missing value: mint).
  - `npm run check:contrast` (also part of `npm test`) checks every text, button and border token pair in every theme
    against WCAG AA (4.5:1 text, 3:1 large text and UI borders) and fails on raw colors in components. It must pass.
  - Every status shows a label or icon and every tier its letter, never color alone.
- Font: Onest (next/font), 400 body and 800 headings. Tier badge codes only use Unbounded 800 (`font-tier`), a
  placeholder until tiers get icons. It covers Uzbek Latin (oʻ, gʻ with U+02BB, ʼ U+02BC),
  Russian and Uzbek Cyrillic; check these glyphs before switching fonts.
- Top floating pill navigation. No sidebar, except the secondary navigation inside /admin.
  The pill shows the links the viewer's role may open; below lg it shrinks to logo plus a menu button that opens a
  full-width sheet. Sticky offsets use `--nav-offset` (`top-(--nav-offset)`).
- Use the component library. Do not build custom form controls for Thursday.
- Every list and screen needs a loading state, an empty state and an error state.
- Most important screens, in this order: leaderboard, reviewer review screen, add achievement, student dashboard, sign-up.
- CV: `/cv` editor (live preview; tabs below lg, side by side from lg), `/cv/[id]` view and `/cv/[id]/print`
  (A4 print stylesheet in `globals.css`; `data-print-page` hides the navigation, `data-shell-chrome` marks it).
- Leaderboard defaults to the current academic year (1 September start), with tabs for earlier years and all-time,
  and filters for university and faculty. It shows tier sections (best first), names in alphabetical order within a
  tier, a tier badge with the letter always visible, no numbered list and no medals (rule 11).
  A switch (`?view=list`, defined in `src/lib/leaderboard-view.ts`) shows the same rows in the same order as one flat
  list with a badge per row. A view changes the layout only, never the data, the order or the cache.

## Working agreements

- Language of code and comments: English.
- One owner for `schema.sql` and migrations. Ask before changing the schema, and add a new migration instead of
  editing an applied one.
  New migrations are applied by hand in the Supabase SQL editor. Do not run `supabase db push`: the remote migration
  history only lists the first two files, so it would re-run migrations that are already live.
- Validate every request body on the server (zod), whatever the form already checks.
- Keep scope tight. For Thursday, cut these first: photo and bio, appeal comment, extra recognition checks.
  Do not build: blockchain, plagiarism detection, quality scoring, notifications.
- Commit small and often. Open pull requests against `main`; during the Thursday sprint pushing directly is fine.

## Portability (so a move to local hosting stays cheap)

- Use Supabase only for Auth, Storage and Postgres. No Edge Functions, no Realtime for core features.
- Access the database and storage through one small server-side module, not scattered across components.
- Keep all business rules in SQL functions or server route handlers, not in client code.

## Commands

- Install: `npm install`
- Dev server: `npm run dev`
- Type check and lint: `npm run lint` and `npx tsc --noEmit`
- Contrast and raw-color check: `npm run check:contrast`
- Tests: `npm test`. Integration tests against the Supabase project in `.env.test.local`, or `.env.local` if there
  is none. They create `test-...@example.invalid` users and remove them afterwards.
- Live-app tests (cache, health, review route access): `npm run build && npx next start -p 3100`, then
  `E2E_BASE_URL=http://localhost:3100 npm run test:e2e`
- Demo data: `npm run seed:demo`; remove all test data with `npm run seed:demo -- --clean`.
  Refuses to run with `NODE_ENV=production` unless `--force` is passed.
- AI extraction check: `npm run test:extract` runs it on every file in `test-certificates/` (gitignored, real
  documents, delete after testing). Needs `AI_EXTRACTION_ENABLED=true` and `ANTHROPIC_API_KEY`; each file is one paid call.

## Open items (do not guess, ask the team)

- Abandoned uploads: a proof uploaded without step 3 stays in the bucket. Limits cap it at about 300 MB per
  account per hour, but open sign-up allows many accounts. Needs a cleanup job before a wider rollout.
- Later: identity verification (university email, HEMIS / student ID) and how it should show on profiles.
- The list of first reviewers (an admin promotes them on `/admin/users`; the first admin is created by SQL).
- Consent v4 and the privacy policy (`t.consent`, `t.privacy`, Uzbek and Russian) and the employer terms
  (`t.employerTerms`, `employer-v1`) are drafts (`draft: true`, shown as such) until the team's text arrives in
  `docs/consent-v2.md`. The landing page's "For employers" copy (`t.home.employers`) is a placeholder. Do not launch with the drafts.
- Employer verification is a manual admin switch on `/admin/users`; what an admin should check before switching it on
  is not decided yet.
- Tier thresholds are placeholders (based on 4 categories x 100 = 400 points per year).
- An employer made by an admin (role change) has no company details and no screen to add them; it cannot send requests.