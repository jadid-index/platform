# Prompts 11-16: admin, tiers, themes, file visibility, employers

New file. Prompts 1-10 stay as they are. Run these in order, one at a time, and commit after each.
Each prompt tells Claude Code to update `CLAUDE.md` and `docs/SPEC.md` itself, so do not paste whole files from me over the repo.

Team decisions behind these prompts (3 Nov):
- Admin pages come early: users, roles, rubric.
- The public sees only a tier (S+/S/A+/A/B/C/D), never exact points and never rank numbers. Exact points are visible to the student, reviewers and admins.
- Uploaded proof files have a visibility setting per work: private / verified / public. Default: verified. Metadata of approved works is always public.
- Employers sign up themselves (student or employer question in onboarding), no admin approval step. Strict checks (tax ID, work email) come later.
- No re-consent for existing accounts (no real users yet). New sign-ups see consent v2.
- Theme system: semantic tokens, more than one theme, a switcher. The default is the "mint" theme (team palette #EFFFFB, #50D890, #4F98CA, #272727); the old green pastel stays as the second.

One consequence of "no employer approval" that the prompts handle: since anyone can register as an employer, the "verified" file level is
reachable only by employers whose `verified` flag an admin sets by hand later. Until then employers see the same files as the public.

---

## Prompt 11: Roles and admin area

```text
Read CLAUDE.md first. First, apply these edits to CLAUDE.md yourself (keep everything else):
- Remove "admin screens" from the "Do not build" list.
- Add a rule: "Roles are student, reviewer, employer, admin. A role is only ever set by an admin or by onboarding (student or employer only).
  Every /admin route and every role-based action is checked on the server."
- Add a rule: "Public views and public APIs never return points or rank numbers; they return tiers (added in Prompt 13).
  Exact points go only to the owner, reviewers and admins."

Then build the admin area. Ask before changing the schema, then add a NEW migration (do not edit applied ones).

1. Schema: add 'employer' to the role enum. Make profile fields that only students need nullable for employers (university, faculty, course) without
   weakening student checks (a student row must still have them).
2. Admin shell under /admin, desktop first, usable on mobile. Only role = admin can open it; reviewers and others get 403 / redirect. Check on the server (middleware and in every route handler).
3. Users page: search by name or email, filter by role and status; change a user's role (student, reviewer, employer, admin) and status (active or hidden).
   Rules: an admin cannot remove their own admin role if they are the last admin; every change writes an audit_log row (who, what, old value, new value, time).
   A hidden status removes the person from public views (the existing kill switch).
4. Audit log page: read-only list of audit_log with filters (actor, action, date).
5. The first admin is still created by SQL (add the exact SQL to the docs). Do not add any way to self-promote.
6. Tests: non-admin cannot read or write anything under /admin or the admin routes; last-admin protection; role change writes an audit row; a reviewer cannot approve their own submission still holds.
7. Update CLAUDE.md and docs/SPEC.md (API table and rules) for what you changed.

Acceptance: lint, tsc and tests pass. Report what you could not verify.
```

---

## Prompt 12: Rubric editor (types and points)

```text
Read CLAUDE.md first. Ask before changing the schema; use a NEW migration.

Goal: admins can change the rubric without a developer, with no effect on points already awarded.

1. Confirm that approved reviews store points_awarded as a snapshot (they should). A rubric edit must never change an existing review row. Show me the evidence (code or test).
2. Admin page "Rubric": 
   - Achievement types: list, add, edit name, category, base points, has_placement, proof hint; deactivate (never delete a type that has submissions). Inactive types are hidden from the student form.
   - Points table (type x level x result): edit each cell (integer, 0 up to the category yearly cap). Offer a helper that fills a row set from base points and multipliers, shown as a preview the admin must confirm.
   - Category yearly cap: editable, same validation.
3. Every change writes an audit_log row with old and new values and a required short reason.
4. Pending submissions are evaluated with the rubric as it is at approval time. Show a note on the editor: "Changes apply to future approvals only."
5. Suggest and add, as seed data in a migration, finer types for journal articles (for example: Scopus/Web of Science indexed, VAK listed, other national, other international), with points I will review in the editor. Mark them as a draft in your report.
6. Tests: editing points does not change existing reviews or the leaderboard; invalid values are rejected; a non-admin cannot edit; inactive types cannot be submitted.
7. docs/jadid_index_rubric_v0.3.xlsx and seed.sql stay as the original seed. Add a line in docs saying the database is now the source of truth after the first edit.
8. Update CLAUDE.md and docs/SPEC.md.

Not in this prompt: correcting already approved reviews (a later, separate prompt).
```

---

## Prompt 13: Tiers instead of public points and ranks

```text
Read CLAUDE.md first. Ask before changing the schema; use a NEW migration.

Goal: the public sees a tier only. Exact points: owner, reviewers, admins.

1. Tiers table (editable by admin in the admin area): code, label, min_points, sort_order. Seed 7 tiers as placeholders, based on a maximum
   of 4 categories x 100 = 400 points per academic year:
   S+ >= 360, S >= 300, A+ >= 240, A >= 180, B >= 120, C >= 60, D >= 1.
   A student with 0 points has no tier ("-").
2. SQL function tier_for(points) using that table. A year view uses that year's points. The all-time view uses the student's best academic year.
3. Change public views and routes (leaderboard, leaderboard_by_year, public_works, /api/leaderboard, /api/leaderboard/:studentId, the landing page Top students card) so they
   return tier, name, faculty and approved-work metadata, and no points and no rank numbers. Per-work points are also hidden publicly (show level and result only).
4. Public ordering: grouped by tier (best first), alphabetical by name within a tier. Remove tie-breaking by approval date from the public view.
5. UI: the leaderboard shows tier sections with a clear tier badge (letter plus color, letter always visible), no numbered list, no medals for ranks 1-3.
   Adjust the landing page Top students card to "Top tier students" (the best non-empty tier). Keep year tabs and filters.
6. The student dashboard and /api/me: the student sees own exact points, own tier and per-category points toward the cap. No rank number.
   Reviewers and admins see exact points where useful (queue, review screen, admin user view).
7. Tests: no public response contains points, rank or approval-order data (add a test that scans the JSON of every public route for those fields); tier boundaries (359/360, 299/300 ...);
   a hidden profile does not appear.
8. Update CLAUDE.md and docs/SPEC.md (ties rule is gone; tiers rule is in).
```

---

## Prompt 14: Theme system and re-skin

```text
Read CLAUDE.md first. Visual work only: no API, SQL or business-rule changes.

Goal: replace the single pastel look with a theme system and a more striking default design.

1. First audit: list every hard-coded color (hex, rgb, Tailwind color names outside the token set) in components. Fix all of them to use semantic tokens.
2. Semantic tokens as CSS variables (background, surface, surface-raised, border, text, muted, primary, primary-contrast, accent, success, warning, danger, tier colors,
   category tints), mapped in the Tailwind config. Themes live in one file; adding a theme must not touch any component.
3. Two themes:
   - "mint" (default), built from the team's palette: #EFFFFB (page background), #50D890 (primary green), #4F98CA (secondary blue), #272727 (text and dark surfaces).
     Contrast rules that follow from these exact colors (measured against WCAG):
       * Text on #EFFFFB is #272727 only (14.5:1).
       * Buttons and chips filled with #50D890 use #272727 text (8.2:1). Never white text on #50D890 (1.8:1).
       * #4F98CA works for fills with #272727 text (4.8:1), icons and large graphics. It is NOT usable as small text or link color on light surfaces (3.05:1).
         Define a darker derived blue token for links and small colored text that reaches 4.5:1, and a darker derived green for green text on light surfaces. Derive them from the palette hues; do not invent new hues.
       * Never put #50D890 or #4F98CA as text on #EFFFFB. Dark surfaces (#272727) may carry #50D890 text (8.2:1) and #4F98CA text (4.8:1).
   - "pastel": the existing soft green pastel theme, kept as the second option.
   Update CLAUDE.md: replace "pastel palette, light mode only" and "no blue or gold branding" with the theme system rules.
4. Switcher in the header (and the profile menu on mobile). Save the choice in a cookie so the server renders the right theme with no flash; fall back to the default if unreadable.
5. Fonts: one well-chosen sans family with strong weight contrast (bold, tight headings; regular body), loaded with next/font. No decorative or serif display font. Check that Uzbek Latin letters
   (o', g' with the correct apostrophe characters), Cyrillic and Russian text render correctly. If a glyph is missing, pick a font that has it.
6. Make it more attractive, not only recolored: stronger hero with a clear headline and one visual element, better spacing and card depth, consistent icon set, tier badges that look good in both themes.
6b. Navigation layout change (replaces the sidebar from Prompt 8 on every public and student screen):
   - Remove the left sidebar. Use a floating pill navigation bar at the top, centered, with rounded full corners, a soft shadow and a slight blur, that stays visible while scrolling
     (sticky with a small margin from the top edge). Left: logo. Middle: the links the user's role may open (Leaderboard; students: My achievements, Add achievement;
     reviewers: Review queue; employers: Talent). Right: language switch, theme switcher, and the sign-in / sign-up buttons or the profile menu.
   - Mobile: the pill shrinks to logo plus a menu button that opens a full-width sheet with the same links. The active link is clearly marked and every icon has a text label.
   - Content gets a top padding so nothing hides under the bar; check anchor links and sticky table headers.
   - /admin keeps a secondary navigation inside the page (a tab bar or a slim side list), because it has many sections; the pill remains on top.
   - Keep keyboard navigation and focus styles working, and the bar must not cover form fields when the mobile keyboard opens.
   Update CLAUDE.md (UI section) to say: "Top floating pill navigation. No sidebar, except the secondary navigation inside /admin."
7. Contrast check as a script (npm run check:contrast) that tests all text/background and button token pairs in every theme against WCAG AA (4.5:1 for text, 3:1 for large text and UI borders). Fail if any pair is below.
8. Every status and tier still shows a label or letter, never color alone.
9. Test the main screens at 375 px and 1440 px in both themes. List anything not verified.
```

---

## Prompt 15: File visibility, consent v2, privacy policy

```text
Read CLAUDE.md first. Ask before changing the schema; use a NEW migration.

A. Visibility
1. Add submissions.file_visibility enum ('private', 'verified', 'public'), default 'verified'; add sensitive_data_flag boolean (set by reviewers) and
   public_confirmed_at timestamp.
2. Files stay in the private bucket. Never expose a storage path or a long-lived URL. New route GET /api/files/:submissionId:
   - only for approved submissions;
   - owner, reviewers and admins: always allowed;
   - 'public': anyone, including signed-out users;
   - 'verified': allowed only for employers whose employer_profiles.verified = true (nobody is verified yet; admins will set it later);
   - 'private': owner, reviewers, admins only;
   - sensitive_data_flag = true: treated as private for everyone except owner, reviewers, admins.
   It returns a redirect to a signed URL that expires in 60 seconds, sends X-Robots-Tag: noindex, and is rate limited.
3. Reviewer review screen: a checkbox "The document shows sensitive data (ID number, passport, address, phone)". When ticked the file can never leave private/owner view.
4. Student dashboard: per approved work, a visibility control with plain explanations. Switching to 'public' opens a confirmation dialog with a preview of the file and a required checkbox
   ("I checked the document: it shows no ID or passport numbers, home address or phone number I do not want public"). Save public_confirmed_at. Switching back is immediate.
5. Public work pages show metadata always (title, issuer, date, level, result, verified badge, certificate reference) and a "View document" link only when the viewer is allowed.
6. Tests: every combination of visibility x viewer role x flag; signed-out user cannot read private or verified files; rejected or pending submissions never return files; no storage path appears in any public response.

B. Consent and policy
1. Consent text version 'v2' (Uzbek, Russian) from docs/consent-v2.md that I will provide; use a placeholder file now and load text from the translations file. New sign-ups see v2.
   Do not force existing accounts to re-consent.
2. Pages /privacy (privacy policy) and a link in the footer and in the sign-up consent step. Text comes from the translations file; use my draft when provided, a clearly marked placeholder otherwise.
3. Update CLAUDE.md rules 4 and 5 for visibility-controlled files and tiers, and docs/SPEC.md.
```

---

## Prompt 16: Employers

```text
Read CLAUDE.md first. Ask before changing the schema; use a NEW migration.

1. Onboarding: first question "Talaba / Ish beruvchi" (student / employer). The student path stays unchanged.
   Employer path asks: company name, contact person, phone or Telegram, optional work email. No email verification and no admin approval (pilot rule 6).
   The server accepts only 'student' or 'employer' as a self-chosen role. Any other value, or a role in an unexpected place, is ignored or rejected.
2. employer_profiles: user_id, company_name, contact_person, contact (phone or Telegram), work_email (optional), verified boolean default false, created_at.
   Add a toggle for "verified" on the admin Users page; changing it writes an audit_log row. Employers cannot set it themselves.
3. Students: add open_to_work boolean default false, controlled on their dashboard with an explanation of what it does.
4. Talent directory at /talent, for signed-in employers and admins only: lists active students with open_to_work = true. Show name, faculty, tier and the approved works metadata according to
   the file visibility rules. Never show exact points, never show rank numbers, never show contact details. Filters: faculty, tier, category. Pagination.
5. Contact requests: table contact_requests (employer_id, student_id, message up to 500 characters, status pending / accepted / declined, created_at, responded_at).
   One pending request per employer-student pair. Rate limit: 10 new requests per employer per day (unverified) and a global safeguard.
   Student sees requests in the dashboard with a badge for new ones (no email is sent; email sending is not solved). The student accepts or declines; on accept the student
   chooses which contact detail to share (phone, Telegram or email) and only then does the employer see it. Declined requests cannot be re-sent for 30 days.
6. Employers cannot call student, reviewer or admin routes; students cannot call employer routes. Add the check on the server for each route.
7. Log each employer view of a student profile in audit_log (employer, student, time).
8. Landing page: add an "For employers" section and a sign-up path for employers; copy from the translations file (placeholder text; I will draft it).
9. Tests: role self-assignment attempts (reviewer, admin) fail; employers see only open_to_work students; no contact detail leaks before acceptance; rate limits; duplicate request blocked; a hidden student does not appear.
10. Update CLAUDE.md and docs/SPEC.md.
```

---

## Not in these prompts

- About / Why choose us / Problem and solution pages and the employer and student benefit texts: I will draft the Uzbek copy, then one small prompt adds the pages.
- Correcting already approved reviews (adjustments): separate prompt after Prompt 12 is working.
- career.edu.uz: ask the directors who runs it and whether it has an API before any plan.
- Strict employer checks (tax ID, work email), real notifications (needs SMTP or a Telegram bot).
