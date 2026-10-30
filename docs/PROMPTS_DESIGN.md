# Design prompts (8-10)

These are new prompts. They do not change Prompts 1-7 or 4b. Run them in order, one at a time, and commit after each.
Direction: landing page first (hero, live counters, top students), a sidebar desktop shell, a table-style leaderboard
with rank medals. Green stays the primary color, the palette stays pastel. Reference: robocontest.uz (layout ideas only,
no copied assets or text).

Before Prompt 8, in the repo, tell Claude Code to change one line in CLAUDE.md (UI section):
"Mobile first. Students will use phones." -> "Mobile first, with a full desktop layout from the `lg` breakpoint up.
Test every screen at 375 px and at 1440 px wide."
Nothing else in CLAUDE.md changes.

---

## Prompt 8: Design foundation and desktop shell

```text
Read CLAUDE.md first. This is a visual change only. Do not touch API routes, SQL, migrations, auth logic or business rules.

Goal: a more attractive, more polished look and a real desktop layout, keeping green as primary and the pastel palette.

1. Tokens: refine the existing Tailwind theme tokens (no hard-coded hex in components). Add: primary-strong (for text and
   buttons that must pass WCAG AA 4.5:1), primary-soft, surface, surface-raised, border, text, muted, plus four category tints
   (scientific, innovation, social, personal growth), and rank colors gold, silver, bronze (soft fills with dark text).
   Status colors stay: pending amber, approved green, rejected rose, and every status keeps its label or icon.
2. Typography: one clean sans font loaded with next/font that supports Latin Extended and Cyrillic (Uzbek and Russian text).
   Define a type scale: display (hero), h1, h2, body, small. Numbers in score columns use tabular figures.
3. Shape and spacing: rounded-xl cards, thin soft borders, soft shadows only on hover, generous spacing,
   max content width about 1200 px on desktop.
4. App shell:
   - Below `lg`: the current mobile layout (top bar, and bottom or drawer navigation as it is now).
   - From `lg` up: a left sidebar with the logo and grouped links (Leaderboard; for students: My achievements,
     Add achievement; for reviewers: Review queue), a top bar with the language switch and the profile or sign-in buttons.
   - The sidebar shows only links the user's role may open. This is for display; server checks stay as they are.
5. Reusable components in one place: Card, Chip, StatTile, RankBadge (1-3 medals, others plain number, the number is always
   visible, never color only), SectionHeader, EmptyState, ErrorState, Skeleton.
6. All new text goes in the translations file (Uzbek Latin default).

Acceptance: `npm run lint`, `npx tsc --noEmit` and `npm test` pass. Every existing screen still works and uses the new shell.
Check each main screen at 375 px and 1440 px and tell me what you checked. Do not redesign individual screens yet.
```

---

## Prompt 9: Landing page and leaderboard

```text
Read CLAUDE.md first. Visual and read-only work: no schema change and no new write routes.

A. Landing page at `/` (public, no login needed), in this order:
1. Hero: a short headline and one sentence about recognized student achievements, buttons "Ro'yxatdan o'tish" (sign up)
   and "Reyting" (leaderboard). If the user is signed in, the first button goes to their dashboard.
2. Counter strip with three live numbers: active students, approved achievements, universities.
   Get them from a server-side query using the secret key, counts only, cached (revalidate 5 minutes).
   No names, emails or other personal data in this response.
3. "Top students" card: top 5 from the current leaderboard (name, faculty, points), link to the full leaderboard.
   Use the same data source as the leaderboard, only public fields.
4. Four category cards (Scientific, Innovation, Social, Personal growth), each with its category tint and a one-line description
   from the translations file.
5. "How it works" in three short steps: upload proof, reviewer confirms, points and rank appear.
6. A closing sign-up call to action and a footer with the contact email fazlddn4@gmail.com.
Mobile: single column, the Top students card directly after the hero.

B. Leaderboard at `/leaderboard`:
1. Desktop: a table with columns rank (RankBadge), student (name, faculty underneath), points, and last approved date.
   Mobile: the same data as a list of cards.
2. Year tabs (current academic year default, earlier years, all-time), search by name, and a filter panel (university, faculty).
   Keep the existing API query parameters; do not change the API.
3. Rows 1-3 get a gold, silver and bronze rank treatment. Rank order and tie-breaking stay exactly as the API returns them.
4. Clicking a row opens the public profile with approved works only (existing endpoint). Never show files or file URLs.
5. Loading skeleton, empty state ("no approved achievements for this year yet" with a hint to switch tabs), and error state with retry.
6. Pagination or "load more" using the existing limit and offset.

Public data stays limited to what CLAUDE.md rule 5 allows. Do not add anything else to public pages.
Acceptance: lint, tsc and tests pass; screenshots or a description of 375 px and 1440 px for both pages; contrast AA on buttons and chips.
```

---

## Prompt 10: Student dashboard and reviewer desktop layout

```text
Read CLAUDE.md first. Layout and styling only; do not change any API, SQL function or validation.

A. Student dashboard
1. Top: points total and rank in two StatTiles, plus a progress bar per category showing points toward the yearly cap
   (use the academic year selector; numbers come from the existing /api/me and /api/submissions responses; if the data
   needed is not there, tell me instead of computing points in the browser).
2. Below: "My achievements" list with status chips (pending amber, approved green, rejected rose, each with a label or icon),
   the rejection reason shown clearly on rejected items, and the resubmit action.
3. Desktop: two columns (stats and categories on one side, the list on the other). Mobile: one column.
4. Add achievement screen: on desktop show the form beside the file preview and the AI suggestions panel; on mobile keep the current flow.
   The student still confirms every field.

B. Reviewer screens
1. Queue: a table on desktop (student, type, submitted date, flags count), cards on mobile; oldest first as now.
2. Review screen on desktop: two columns. Left: the proof file viewer (signed URL). Right: submission details, the
   "Tanib olish tekshiruvi" panel (OK / Check this with both values), the type, level and result selectors, the points preview
   with the cap effect, and Approve / Reject (reason required). Mobile: stacked, file first.
3. Keep the self-review block and all server checks untouched.

Acceptance: lint, tsc and tests pass; the full path works on 1440 px and 375 px (sign up, add achievement, review, approve,
leaderboard). List anything you could not verify.
```

---

## After all three

- Show screenshots to the founder before the Thursday demo. Ask for changes in a small batch, not screen by screen.
- Small tweaks (colors, spacing) are edits to tokens, not new prompts.
