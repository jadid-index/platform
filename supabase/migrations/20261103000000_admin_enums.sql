-- Admin area, part 1 (3 Nov). New enum values live in their own migration, so they are committed before
-- anything in 20261103000001_admin_functions.sql runs.
--   employer: a role set only by an admin or by employer onboarding (CLAUDE.md rule 10).
--   hidden:   set by an admin on /admin/users; hides the person from every public view (the kill switch).
alter type user_role      add value if not exists 'employer';
alter type profile_status add value if not exists 'hidden';
