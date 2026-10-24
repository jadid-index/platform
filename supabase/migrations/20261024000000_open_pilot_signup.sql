-- Pilot sign-up is open: any email address, no email verification (team decision, 24 Oct, temporary).
-- The trigger stays attached and allowed_email_domains keeps its rows, so identity verification
-- (university email, HEMIS / student ID) can be restored here after the pilot.
create or replace function enforce_student_email() returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  return new;
end $$;

comment on column profiles.status is
  'active by default; set pending or rejected by hand to hide a fake account from the leaderboard';
