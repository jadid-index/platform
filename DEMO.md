# Thursday demo

Live URL: `https://<your-project>.vercel.app` (fill in after the first deploy).

## Before the demo (Wednesday evening)

- [ ] One reviewer account exists (profile with `role = 'reviewer'`) and you can log in with it.
- [ ] One demo student account is ready, plus one fresh `@iiau.uz` inbox you can open on stage for the sign-up step.
- [ ] Custom SMTP is configured in Supabase, so the confirmation email arrives within seconds.
- [ ] Two proof files on the demo phone: a real certificate PDF and a JPG photo of one, both under 10 MB.
- [ ] At least one approved achievement dated on or after 2026-09-01, so the current-year tab is not empty.
      Without it, the home page falls back to 2025/26 with a notice, which is fine but worth explaining.
- [ ] The backup video of the full path is recorded and saved offline.

## Click path (about 5 minutes)

1. **Leaderboard** (logged out): open the live URL. Show the year tabs, "Barcha yillar", the faculty filter,
   and open one student to show their approved works. Point out: no files are public, only titles and points.
2. **Sign-up**: tap "Roʻyxatdan oʻtish".
   - Pilot sign-up is open: any email works, no confirmation email is sent.
   - Fill the form, show that the button stays disabled until consent is ticked. You land on the dashboard.
   - Or tap "Google orqali davom etish": after Google, onboarding asks for name (prefilled, editable),
     faculty, course and consent, then the dashboard. No Google photo is imported.
3. **Add achievement**: "Yutuq qoʻshish".
   - Pick Olympiad, National, Winner and show the "Oldindan koʻrish" points (16).
   - Switch to Journal article: the labels change and the DOI field becomes required.
   - Fill in, upload the PDF, submit. The dashboard shows it as "Koʻrib chiqilmoqda".
4. **Review**: log out, log in as the reviewer, tap "Koʻrib chiqish" in the header.
   - Open the submission: file on one side, data and points preview on the other.
   - Change the level and show the preview update. Point out the yearly cap line.
   - Approve. Show the "Tasdiqlandi: N ball" message.
5. **Back to the leaderboard**: the student appears with the new points straight away.
6. (Optional) Reject a second submission with a reason, then show the reason on the student's dashboard.

Talking point for AI: the "AI baholash" panel is a placeholder. AI will only pre-fill and flag; people decide.

## Checklist on the live URL

### Desktop
- [ ] Home page loads without login, tabs and filters work, a student page opens.
- [ ] Sign-up with any address (for example `@gmail.com`) lands on the dashboard with no email sent
      ("Confirm email" is off in Supabase Auth).
- [ ] "Google orqali davom etish" on the live domain returns to the live domain (not localhost), a new Google
      user lands on onboarding, a returning one on the dashboard. Cancelling on Google's screen shows the error page.
- [ ] Add achievement with a 9 MB PDF works (direct upload to storage, not through Vercel).
- [ ] A `.docx` renamed to `.pdf` is refused.
- [ ] The same file submitted twice shows "Bu hujjat allaqachon yuborilgan."
- [ ] Withdraw works on a pending item.
- [ ] A student opening `/review` sees "faqat koʻrib chiquvchilar uchun"; the header has no review link.
- [ ] Reviewer: PDF shows inline, "Faylni yangi oynada ochish" works, approve and reject work.
- [ ] After an approval, two different browsers and `/api/leaderboard?academic_year=2026` all show the new points
      within a few seconds (checks that the server cache is shared and purged).
- [ ] The proof file URL stops working after 10 minutes.
- [ ] Log out, log back in: the logout button is back to normal and no old data shows.
- [ ] Vercel function logs show no errors during the run-through.

### Phone (375 px, real device, mobile data and Wi-Fi)
- [ ] Every screen fits without sideways scrolling: home, student page, sign-up, onboarding, dashboard,
      add achievement, review queue, review screen.
- [ ] Dropdowns open and are easy to tap; the date picker opens the native picker.
- [ ] Uploading a photo straight from the camera works. On iPhone, Safari usually converts HEIC photos to JPG
      because the form only accepts JPG/PNG/PDF; if a HEIC file still gets through, it is refused with a clear message.
- [ ] The confirmation email link opens correctly from the phone's mail app.
- [ ] Reviewer on the phone: if the PDF does not render inline, "Faylni yangi oynada ochish" opens it.
- [ ] Text is readable, buttons have enough contrast, every status badge shows a label and icon.
