-- Employers (7 Nov): employer onboarding, the opt-in talent directory and contact requests.
-- Pilot rule 6: no email verification and no admin approval for employers. An admin may mark an employer as
-- verified on /admin/users (more requests per day, and 'verified' documents). Students opt in with open_to_work;
-- an employer sees a student's contact detail only after the student accepts a request and picks what to share.

-- 1. Employer details. The column stays profile_id (the user's id), like the rest of the schema.
--    Rows created before this migration are test data, so the check is NOT VALID (it applies to new and changed rows).
alter table employer_profiles
  add column company_name   text,
  add column contact_person text,
  add column contact        text,
  add column work_email     text,
  add column created_at     timestamptz not null default now();

alter table employer_profiles add constraint employer_fields check (
  char_length(trim(company_name)) between 2 and 120
  and char_length(trim(contact_person)) between 2 and 120
  and char_length(trim(contact)) between 3 and 64
  and (work_email is null or char_length(work_email) <= 254)
) not valid;

-- 2. Students opt in to the talent directory (default off).
alter table profiles add column open_to_work boolean not null default false;

-- 3. Contact requests from an employer to a student.
create type contact_request_status as enum ('pending', 'accepted', 'declined');
create type contact_kind           as enum ('phone', 'telegram', 'email');

create table contact_requests (
  id                   uuid primary key default gen_random_uuid(),
  employer_id          uuid not null references profiles(id) on delete cascade,
  student_id           uuid not null references profiles(id) on delete cascade,
  message              text not null check (char_length(trim(message)) between 1 and 500),
  status               contact_request_status not null default 'pending',
  shared_contact_kind  contact_kind,
  shared_contact_value text check (shared_contact_value is null or char_length(shared_contact_value) between 3 and 254),
  created_at           timestamptz not null default now(),
  responded_at         timestamptz,
  constraint contact_requests_not_self check (employer_id <> student_id),
  constraint contact_requests_shared check (
    (status = 'accepted') = (shared_contact_kind is not null and shared_contact_value is not null)
  ),
  constraint contact_requests_responded check ((status = 'pending') = (responded_at is null))
);
create unique index contact_requests_one_pending on contact_requests (employer_id, student_id) where status = 'pending';
create index contact_requests_student_idx  on contact_requests (student_id, status, created_at desc);
create index contact_requests_employer_idx on contact_requests (employer_id, created_at desc);
create index contact_requests_created_idx  on contact_requests (created_at);
alter table contact_requests enable row level security;   -- no policy: server only

revoke all on contact_requests from public, anon, authenticated;
grant select, insert, update, delete on contact_requests to service_role;

-- 4. Employer onboarding. The role is fixed here ('employer'), never taken from the caller.
--    A profile that an admin already made an employer, but without company details, only gets the details.
create or replace function create_employer_profile(
  p_user           uuid,
  p_company        text,
  p_person         text,
  p_contact        text,
  p_work_email     text,
  p_terms_version  text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_role user_role;
begin
  select role into v_role from profiles where id = p_user for update;
  if found then
    if v_role <> 'employer' or exists (select 1 from employer_profiles where profile_id = p_user) then
      raise exception 'profile_exists';
    end if;
  else
    insert into profiles (id, full_name, role, status, consent_version, consent_at)
    values (p_user, trim(p_person), 'employer', 'active', p_terms_version, now());
  end if;

  insert into employer_profiles (profile_id, company_name, contact_person, contact, work_email, verified)
  values (p_user, trim(p_company), trim(p_person), trim(p_contact), nullif(trim(coalesce(p_work_email, '')), ''), false);

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_user, 'employer.onboarded', 'profile', p_user::text, jsonb_build_object('terms_version', p_terms_version));
end $$;

-- 5. A student turns open_to_work on or off.
create or replace function set_open_to_work(p_student uuid, p_value boolean) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_old boolean;
begin
  select open_to_work into v_old from profiles
   where id = p_student and role = 'student' and status = 'active' for update;
  if not found then raise exception 'not_active_student'; end if;
  if v_old = coalesce(p_value, false) then return v_old; end if;

  update profiles set open_to_work = coalesce(p_value, false) where id = p_student;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, 'profile.open_to_work', 'profile', p_student::text,
          jsonb_build_object('old', v_old, 'new', coalesce(p_value, false)));
  return coalesce(p_value, false);
end $$;

-- 6. An admin marks an employer as verified (or not). Employers can never call this for themselves:
--    the actor must be an active admin.
create or replace function admin_set_employer_verified(p_actor uuid, p_target uuid, p_verified boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old boolean;
begin
  perform pg_advisory_xact_lock(hashtext('jadid.admin_changes'));

  if not exists (select 1 from profiles where id = p_actor and role = 'admin' and status = 'active') then
    raise exception 'not an admin';
  end if;
  if not exists (select 1 from profiles where id = p_target and role = 'employer') then
    raise exception 'not an employer';
  end if;

  select verified into v_old from employer_profiles where profile_id = p_target for update;
  if not found then raise exception 'not an employer'; end if;

  if v_old = coalesce(p_verified, false) then
    return jsonb_build_object('old', v_old, 'new', v_old, 'changed', false);
  end if;

  update employer_profiles
     set verified    = coalesce(p_verified, false),
         verified_at = case when p_verified then now() else null end,
         verified_by = case when p_verified then p_actor else null end
   where profile_id = p_target;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'employer.verified_changed', 'profile', p_target::text,
          jsonb_build_object('old', v_old, 'new', coalesce(p_verified, false)));

  return jsonb_build_object('old', v_old, 'new', coalesce(p_verified, false), 'changed', true);
end $$;

-- 7. An employer sends a contact request. One global lock serializes all requests, so the per-employer and the
--    global 24-hour limits cannot be raced past. Limits: 10 a day (unverified), 30 a day (verified), and
--    p_global_cap a day across all employers (CONTACT_REQUESTS_DAILY_CAP on the server).
create or replace function create_contact_request(
  p_employer   uuid,
  p_student    uuid,
  p_message    text,
  p_global_cap int
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_verified boolean;
  v_limit    int;
  v_id       uuid;
begin
  perform pg_advisory_xact_lock(hashtext('jadid.contact_requests'));

  if not exists (select 1 from profiles where id = p_employer and role = 'employer' and status = 'active') then
    raise exception 'not_active_employer';
  end if;
  -- An employer made by an admin on /admin/users has no company details; students must know who is asking.
  if not exists (select 1 from employer_profiles where profile_id = p_employer and company_name is not null) then
    raise exception 'employer_profile_missing';
  end if;
  if not exists (select 1 from profiles
                  where id = p_student and role = 'student' and status = 'active' and open_to_work) then
    raise exception 'student_not_available';
  end if;
  if char_length(trim(coalesce(p_message, ''))) not between 1 and 500 then
    raise exception 'invalid_message';
  end if;

  if exists (select 1 from contact_requests
              where employer_id = p_employer and student_id = p_student and status = 'pending') then
    raise exception 'duplicate_pending';
  end if;
  if exists (select 1 from contact_requests
              where employer_id = p_employer and student_id = p_student and status = 'accepted') then
    raise exception 'already_accepted';
  end if;
  if exists (select 1 from contact_requests
              where employer_id = p_employer and student_id = p_student and status = 'declined'
                and responded_at > now() - interval '30 days') then
    raise exception 'declined_cooldown';
  end if;

  select coalesce(verified, false) into v_verified from employer_profiles where profile_id = p_employer;
  v_limit := case when coalesce(v_verified, false) then 30 else 10 end;
  if (select count(*) from contact_requests
       where employer_id = p_employer and created_at > now() - interval '24 hours') >= v_limit then
    raise exception 'rate_limited';
  end if;
  if (select count(*) from contact_requests where created_at > now() - interval '24 hours')
     >= greatest(coalesce(p_global_cap, 300), 0) then
    raise exception 'rate_limited_global';
  end if;

  insert into contact_requests (employer_id, student_id, message)
  values (p_employer, p_student, trim(p_message))
  returning id into v_id;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_employer, 'contact_request.created', 'profile', p_student::text, jsonb_build_object('request_id', v_id));
  return v_id;
end $$;

-- 8. The student accepts (sharing one contact detail) or declines. The contact value is never written to audit_log.
create or replace function respond_contact_request(
  p_student uuid,
  p_request uuid,
  p_accept  boolean,
  p_kind    contact_kind,
  p_value   text
) returns void
language plpgsql security definer set search_path = public as $$
declare
  r contact_requests;
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student' and status = 'active') then
    raise exception 'not_active_student';
  end if;
  select * into r from contact_requests where id = p_request for update;
  if not found or r.student_id <> p_student then raise exception 'not_found'; end if;
  if r.status <> 'pending' then raise exception 'already_answered'; end if;

  if p_accept then
    if p_kind is null or char_length(trim(coalesce(p_value, ''))) < 3 then raise exception 'contact_required'; end if;
    update contact_requests
       set status = 'accepted', responded_at = now(), shared_contact_kind = p_kind, shared_contact_value = trim(p_value)
     where id = p_request;
  else
    update contact_requests set status = 'declined', responded_at = now() where id = p_request;
  end if;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, case when p_accept then 'contact_request.accepted' else 'contact_request.declined' end,
          'profile', r.employer_id::text,
          jsonb_build_object('request_id', p_request, 'kind', case when p_accept then p_kind end));
end $$;

-- 9. The talent directory: active students who opted in, with the all-time tier (best academic year, as in the
--    leaderboard view) and the number of approved works. No points, no rank, no contact details.
--    Students without approved work are listed with no tier. The server sorts (tier, then Uzbek name order)
--    and pages the rows.
create or replace function talent_directory(
  p_faculty  int  default null,
  p_tier     text default null,
  p_category text default null
) returns table (
  student_id uuid, full_name text, university text, faculty_id int, faculty text, approved_count int,
  tier_code text, tier_label jsonb, tier_sort int
)
language sql stable security definer set search_path = public as $$
  select p.id, p.full_name, u.name, p.faculty_id, f.name, coalesce(l.approved_count, 0),
         l.tier_code, l.tier_label, l.tier_sort
    from profiles p
    left join universities u on u.id = p.university_id
    left join faculties f    on f.id = p.faculty_id
    left join leaderboard l  on l.student_id = p.id
   where p.role = 'student' and p.status = 'active' and p.open_to_work
     and (p_faculty is null or p.faculty_id = p_faculty)
     and (p_tier is null or l.tier_code = p_tier)
     and (p_category is null or exists (
           select 1 from reviews r
            where r.student_id = p.id and r.decision = 'approved' and r.category_code = p_category))
$$;

-- 10. Server only (secret key = service_role).
revoke execute on function create_employer_profile(uuid, text, text, text, text, text) from public, anon, authenticated;
revoke execute on function set_open_to_work(uuid, boolean) from public, anon, authenticated;
revoke execute on function admin_set_employer_verified(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function create_contact_request(uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function respond_contact_request(uuid, uuid, boolean, contact_kind, text) from public, anon, authenticated;
revoke execute on function talent_directory(int, text, text) from public, anon, authenticated;
grant execute on function create_employer_profile(uuid, text, text, text, text, text) to service_role;
grant execute on function set_open_to_work(uuid, boolean) to service_role;
grant execute on function admin_set_employer_verified(uuid, uuid, boolean) to service_role;
grant execute on function create_contact_request(uuid, uuid, text, int) to service_role;
grant execute on function respond_contact_request(uuid, uuid, boolean, contact_kind, text) to service_role;
grant execute on function talent_directory(int, text, text) to service_role;
