-- Jadid Index MVP schema (v0.3)
-- PostgreSQL 15+, written for Supabase (uses auth.users and auth.uid()).
-- All writes go through the server API with the service-role key.
-- The browser only reads what the RLS policies at the bottom allow.

-- ---------------------------------------------------------------- enums
create type user_role         as enum ('student', 'reviewer', 'admin', 'employer');   -- employer: 20261103000000
create type profile_status    as enum ('pending', 'active', 'rejected', 'hidden');  -- hidden: set on /admin/users
create type level_t           as enum ('university', 'national', 'international');
create type result_t          as enum ('participant', 'finalist', 'winner', 'confirmed');
create type submission_status as enum ('pending', 'approved', 'rejected', 'withdrawn');
create type file_visibility_t as enum ('private', 'verified', 'public');               -- 20261106000000
create type contact_request_status as enum ('pending', 'accepted', 'declined');        -- 20261107000000
create type contact_kind           as enum ('phone', 'telegram', 'email');             -- 20261107000000

-- ------------------------------------------------------- reference data
create table universities (
  id   serial primary key,
  name text not null unique
);

create table faculties (
  id            serial primary key,
  university_id int  not null references universities(id),
  name          text not null,
  unique (university_id, name)
);

create table categories (
  code       text primary key,                       -- 'scientific', 'innovation', ...
  name       text not null,
  yearly_cap int  not null default 100 check (yearly_cap > 0)
);

create table achievement_types (
  id             smallint primary key,
  category_code  text not null references categories(code),
  name           jsonb not null,                     -- {"uz": required, "en", "ru"} (20261104000000)
  base_points    int  not null check (base_points >= 0),
  has_placement  boolean not null default false,     -- true: participant / finalist / winner
  proof_hint     text,                               -- what the reviewer checks
  active         boolean not null default true,      -- inactive: hidden from the form, cannot be submitted
  certificate_ref_required boolean not null default false,
  constraint achievement_types_name_check
    check (jsonb_typeof(name) = 'object' and length(trim(coalesce(name->>'uz', ''))) > 0)
);
create unique index achievement_types_name_uz_uq on achievement_types (lower(name->>'uz'));

-- One row per valid (type, level, result). Generated from the Points sheet of the rubric.
create table rubric_points (
  id      serial primary key,
  type_id smallint not null references achievement_types(id),
  level   level_t  not null,
  result  result_t not null,
  points  int      not null check (points >= 0),
  unique (type_id, level, result)
);

create table app_settings (
  key   text primary key,
  value text not null
);
-- 'count_from': achievements dated before this day are not scored (see seed.sql).

-- ------------------------------------------------------------- profiles
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  full_name       text not null,
  university_id   int  references universities(id),                -- required for students (student_fields)
  faculty_id      int  references faculties(id),
  course          smallint check (course between 1 and 6),
  role            user_role      not null default 'student',
  status          profile_status not null default 'active',    -- active once the university email is verified; pending/rejected are for admin use
  photo_path      text,
  bio             text check (char_length(bio) <= 300),
  telegram        text,
  consent_version text,
  consent_at      timestamptz,                                  -- employers: the employer terms version (employer-v1)
  open_to_work    boolean not null default false,              -- students opt in to /talent (20261107000000)
  created_at      timestamptz not null default now(),
  constraint student_fields check (
    role <> 'student'
    or (university_id is not null and faculty_id is not null and course is not null
        and consent_version is not null and consent_at is not null)
  )
);

-- Only a verified email on one of these domains can get a student profile.
-- Empty by default, so nobody can register until you add the university's domain(s), for example:
--   insert into allowed_email_domains (domain) values ('university.example');
create table allowed_email_domains (
  domain text primary key check (domain = lower(domain))
);

-- Pilot: replaced by a no-op in migration 20261024000000_open_pilot_signup.sql (open sign-up, CLAUDE.md rule 6).
create or replace function enforce_student_email() returns trigger
language plpgsql security definer set search_path = public, auth as $$
declare
  v_email     text;
  v_confirmed timestamptz;
begin
  if new.role = 'student' then
    select email, email_confirmed_at into v_email, v_confirmed
      from auth.users where id = new.id;
    if v_email is null then raise exception 'no auth user for this profile'; end if;
    if v_confirmed is null then raise exception 'email is not verified'; end if;
    if not exists (select 1 from allowed_email_domains
                   where domain = lower(split_part(v_email, '@', 2))) then
      raise exception 'email domain is not allowed';
    end if;
  end if;
  return new;
end $$;

create trigger profiles_student_email before insert on profiles
  for each row execute function enforce_student_email();

-- ---------------------------------------------------------- submissions
create table submissions (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references profiles(id) on delete cascade,
  type_id          smallint not null,
  level            level_t  not null,
  result           result_t not null,
  title            text not null,
  issuer           text not null,
  achievement_date date not null,
  certificate_ref  text,                              -- certificate number, DOI or official link
  note             text check (char_length(note) <= 300),
  file_path        text not null,                     -- private storage bucket 'proofs'
  file_sha256      text not null,
  status           submission_status not null default 'pending',
  parent_id        uuid references submissions(id),   -- set when resubmitting after a rejection
  student_comment  text,
  ai_extraction    jsonb,                             -- raw extraction result
  ai_flags         jsonb,                             -- cross-check flags for the reviewer
  submitted_at     timestamptz not null default now(),
  -- who may open the file (CLAUDE.md rule 4, migration 20261106000000); the owner changes it via set_file_visibility()
  file_visibility     file_visibility_t not null default 'verified',
  sensitive_data_flag boolean not null default false,       -- set by reviewers; forces private
  public_confirmed_at timestamptz,                          -- the owner confirmed the file shows no sensitive data
  constraint submissions_public_confirmed check (file_visibility <> 'public' or public_confirmed_at is not null),
  constraint submissions_sensitive_private check (not sensitive_data_flag or file_visibility = 'private'),
  -- the student can only pick a combination that exists in the rubric
  foreign key (type_id, level, result) references rubric_points (type_id, level, result)
);

create index submissions_queue_idx    on submissions (status, submitted_at);
create index submissions_student_idx  on submissions (student_id, submitted_at desc);
create index submissions_cert_ref_idx on submissions (lower(certificate_ref)) where certificate_ref is not null;
-- the same file cannot be live twice (a rejected or withdrawn file can be resubmitted)
create unique index submissions_live_file_uq on submissions (file_sha256)
  where status in ('pending', 'approved');

-- --------------------------------------------------------------- reviews
-- One row per decision. This is also the points ledger and the audit trail.
create table reviews (
  id               uuid primary key default gen_random_uuid(),
  submission_id    uuid not null unique references submissions(id) on delete cascade,
  student_id       uuid not null references profiles(id),
  reviewer_id      uuid not null references profiles(id),
  decision         text not null check (decision in ('approved', 'rejected')),
  final_type_id    smallint,
  final_level      level_t,
  final_result     result_t,
  rubric_points    int,                               -- points before the yearly cap
  points_awarded   int,                               -- points after the yearly cap
  category_code    text references categories(code),
  academic_year    int,                               -- start year, e.g. 2026 = 2026/27
  rejection_reason text,
  reviewed_at      timestamptz not null default now(),
  foreign key (final_type_id, final_level, final_result)
    references rubric_points (type_id, level, result),
  check (
    (decision = 'approved'
       and final_type_id is not null and final_level is not null and final_result is not null
       and points_awarded is not null and category_code is not null and academic_year is not null)
    or
    (decision = 'rejected'
       and rejection_reason is not null and length(trim(rejection_reason)) > 0)
  )
);

create index reviews_cap_idx on reviews (student_id, category_code, academic_year)
  where decision = 'approved';

create table audit_log (
  id         bigserial primary key,
  actor_id   uuid references profiles(id),
  action     text not null,                           -- 'submission.approved', 'profile.approved', ...
  entity     text not null,
  entity_id  text not null,
  details    jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------- functions
-- Academic year starts on 1 September. Returns the start year (2026 = 2026/27).
create or replace function academic_year(d date) returns int
language sql immutable as $$
  select extract(year from d)::int - case when extract(month from d) < 9 then 1 else 0 end
$$;

-- Approve a pending submission. The reviewer may correct type / level / result.
-- Applies the yearly category cap and writes the review and the audit entry atomically.
create or replace function approve_submission(
  p_submission uuid,
  p_reviewer   uuid,
  p_type       int,
  p_level      level_t,
  p_result     result_t
) returns reviews
language plpgsql as $$
declare
  s          submissions;
  r          reviews;
  v_cat      text;
  v_cap      int;
  v_base     int;
  v_used     int;
  v_year     int;
  v_awarded  int;
  v_from     date;
begin
  select * into s from submissions where id = p_submission for update;
  if not found then raise exception 'submission not found'; end if;
  if s.status <> 'pending' then raise exception 'submission is not pending'; end if;

  if not exists (select 1 from profiles
                 where id = p_reviewer and role in ('reviewer', 'admin') and status = 'active') then
    raise exception 'not an active reviewer';
  end if;
  if s.student_id = p_reviewer then
    raise exception 'reviewers cannot review their own submissions';
  end if;

  select value::date into v_from from app_settings where key = 'count_from';
  if s.achievement_date < v_from then
    raise exception 'achievement date is before the counting start date (%)', v_from;
  end if;

  select points into v_base from rubric_points
   where type_id = p_type and level = p_level and result = p_result;
  if not found then raise exception 'invalid type / level / result combination'; end if;

  select t.category_code, c.yearly_cap into v_cat, v_cap
    from achievement_types t join categories c on c.code = t.category_code
   where t.id = p_type;

  v_year := academic_year(s.achievement_date);

  -- serialize concurrent approvals for the same student and category
  perform pg_advisory_xact_lock(hashtext(s.student_id::text || v_cat));

  select coalesce(sum(points_awarded), 0) into v_used from reviews
   where student_id = s.student_id and decision = 'approved'
     and category_code = v_cat and academic_year = v_year;

  v_awarded := greatest(0, least(v_base, v_cap - v_used));

  update submissions set status = 'approved' where id = s.id;

  insert into reviews (submission_id, student_id, reviewer_id, decision,
                       final_type_id, final_level, final_result,
                       rubric_points, points_awarded, category_code, academic_year)
  values (s.id, s.student_id, p_reviewer, 'approved',
          p_type, p_level, p_result,
          v_base, v_awarded, v_cat, v_year)
  returning * into r;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_reviewer, 'submission.approved', 'submission', s.id::text,
          jsonb_build_object('rubric_points', v_base, 'points_awarded', v_awarded,
                             'category', v_cat, 'academic_year', v_year));
  return r;
end $$;

create or replace function reject_submission(
  p_submission uuid,
  p_reviewer   uuid,
  p_reason     text
) returns reviews
language plpgsql as $$
declare
  s submissions;
  r reviews;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'a rejection reason is required';
  end if;

  select * into s from submissions where id = p_submission for update;
  if not found then raise exception 'submission not found'; end if;
  if s.status <> 'pending' then raise exception 'submission is not pending'; end if;

  if not exists (select 1 from profiles
                 where id = p_reviewer and role in ('reviewer', 'admin') and status = 'active') then
    raise exception 'not an active reviewer';
  end if;
  if s.student_id = p_reviewer then
    raise exception 'reviewers cannot review their own submissions';
  end if;

  update submissions set status = 'rejected' where id = s.id;

  insert into reviews (submission_id, student_id, reviewer_id, decision, rejection_reason)
  values (s.id, s.student_id, p_reviewer, 'rejected', trim(p_reason))
  returning * into r;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_reviewer, 'submission.rejected', 'submission', s.id::text,
          jsonb_build_object('reason', trim(p_reason)));
  return r;
end $$;

-- ----------------------------------------------------------------- tiers
-- The public sees a tier, never points (CLAUDE.md rule 11). From migration 20261105000000_tiers.sql.
create table tiers (
  code       text primary key check (code ~ '^[A-Za-z0-9+-]{1,8}$'),
  label      jsonb not null check (jsonb_typeof(label) = 'object' and length(trim(coalesce(label->>'uz', ''))) > 0),
  min_points int  not null unique check (min_points between 1 and 100000),
  sort_order int  not null check (sort_order >= 1),
  constraint tiers_sort_order_key unique (sort_order) deferrable initially deferred
);
alter table tiers enable row level security;   -- no policy: server only

insert into tiers (code, label, min_points, sort_order) values
  ('S+', '{"uz": "S+"}', 360, 1),
  ('S',  '{"uz": "S"}',  300, 2),
  ('A+', '{"uz": "A+"}', 240, 3),
  ('A',  '{"uz": "A"}',  180, 4),
  ('B',  '{"uz": "B"}',  120, 5),
  ('C',  '{"uz": "C"}',   60, 6),
  ('D',  '{"uz": "D"}',    1, 7);

-- The best tier whose min_points the points reach; no row below the lowest tier (0 points: no tier, shown as "-").
create or replace function tier_for(p_points int) returns setof tiers
language sql stable set search_path = public as $$
  select * from tiers
   where p_points is not null and min_points <= p_points
   order by min_points desc
   limit 1
$$;

-- ----------------------------------------------------------------- views
-- Server-only views (the app reads them with the secret key). No points, rank, approval time or course.
-- One row per student and academic year with approved work. The tier comes from that year's points.
create view leaderboard_by_year as
with yearly as (
  select r.student_id, r.academic_year, sum(r.points_awarded)::int as points, count(*)::int as approved_count
    from reviews r
   where r.decision = 'approved'
   group by r.student_id, r.academic_year
)
select p.id           as student_id,
       p.full_name,
       p.photo_path,
       p.university_id,
       u.name         as university,
       p.faculty_id,
       f.name         as faculty,
       y.academic_year,
       y.approved_count,
       t.code         as tier_code,
       t.label        as tier_label,
       t.sort_order   as tier_sort
  from yearly y
  join profiles p          on p.id = y.student_id
  join universities u      on u.id = p.university_id
  left join faculties f    on f.id = p.faculty_id
  left join lateral tier_for(y.points) t on true
 where p.role = 'student' and p.status = 'active';

-- All-time: one row per student with approved work. The tier comes from the student's best academic year,
-- so it is on the same 0-400 scale as the yearly tiers.
create view leaderboard as
with yearly as (
  select r.student_id, r.academic_year, sum(r.points_awarded)::int as points, count(*)::int as approved_count
    from reviews r
   where r.decision = 'approved'
   group by r.student_id, r.academic_year
), best as (
  select student_id, max(points) as best_points, sum(approved_count)::int as approved_count
    from yearly
   group by student_id
)
select p.id           as student_id,
       p.full_name,
       p.photo_path,
       p.university_id,
       u.name         as university,
       p.faculty_id,
       f.name         as faculty,
       b.approved_count,
       t.code         as tier_code,
       t.label        as tier_label,
       t.sort_order   as tier_sort
  from best b
  join profiles p          on p.id = b.student_id
  join universities u      on u.id = p.university_id
  left join faculties f    on f.id = p.faculty_id
  left join lateral tier_for(b.best_points) t on true
 where p.role = 'student' and p.status = 'active';

-- Approved works on a public profile and work page: never points, the file path, the raw visibility or the flag.
create view public_works as
select r.student_id,
       s.id               as submission_id,
       s.title,
       r.final_type_id    as type_id,
       t.name             as type_name,
       r.final_level      as level,
       r.final_result     as result,
       s.achievement_date,
       s.issuer,
       s.certificate_ref,
       (s.file_visibility = 'public' and not s.sensitive_data_flag) as file_public
  from reviews r
  join submissions s       on s.id = r.submission_id
  join achievement_types t on t.id = r.final_type_id
 where r.decision = 'approved';

-- ------------------------------------------------- row level security
alter table universities        enable row level security;
alter table faculties           enable row level security;
alter table categories          enable row level security;
alter table achievement_types   enable row level security;
alter table rubric_points       enable row level security;
alter table app_settings        enable row level security;   -- no policy: server only
alter table profiles            enable row level security;
alter table allowed_email_domains enable row level security; -- no policy: server only
alter table submissions         enable row level security;
alter table reviews             enable row level security;
alter table audit_log           enable row level security;   -- no policy: server only

create or replace function is_reviewer() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                 where id = auth.uid() and role in ('reviewer', 'admin') and status = 'active')
$$;

-- sign-up needs these before the user is logged in
create policy ref_read_anon on universities for select using (true);
create policy ref_read_anon on faculties    for select using (true);
create policy ref_read      on categories        for select to authenticated using (true);
create policy ref_read      on achievement_types for select to authenticated using (true);
create policy ref_read      on rubric_points     for select to authenticated using (true);

create policy profiles_read    on profiles    for select using (id = auth.uid() or is_reviewer());
create policy submissions_read on submissions for select using (student_id = auth.uid() or is_reviewer());
create policy reviews_read     on reviews     for select using (student_id = auth.uid() or is_reviewer());

-- No insert / update / delete policies: the browser cannot write.
-- The views run with the owner's rights. The leaderboard is visible without login, but only through the API,
-- which returns the public fields (CLAUDE.md rules 5 and 11).
-- Since 20261025000000 the browser roles cannot read the views; the server reads them with the secret key.
revoke all on leaderboard, leaderboard_by_year, public_works from public, anon, authenticated;
grant select on leaderboard, leaderboard_by_year, public_works to service_role;

-- ------------------------------------------------------------ admin area
-- From migration 20261103000001_admin_functions.sql.
-- 2. Role and status changes. Only an active admin may call them (checked here, not only in the app).
--    One advisory lock serializes every admin change, so two admins cannot demote each other at the same time
--    and leave nobody. The update and its audit_log row are written in one transaction.
create or replace function admin_set_role(p_actor uuid, p_target uuid, p_role user_role)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old    user_role;
  v_status profile_status;
begin
  perform pg_advisory_xact_lock(hashtext('jadid.admin_changes'));

  if not exists (select 1 from profiles where id = p_actor and role = 'admin' and status = 'active') then
    raise exception 'not an admin';
  end if;

  select role, status into v_old, v_status from profiles where id = p_target for update;
  if not found then raise exception 'user not found'; end if;

  if v_old = p_role then
    return jsonb_build_object('old', v_old, 'new', p_role, 'changed', false);
  end if;

  if v_old = 'admin' and v_status = 'active'
     and not exists (select 1 from profiles where role = 'admin' and status = 'active' and id <> p_target) then
    raise exception 'last admin';
  end if;

  -- Becoming a student without faculty / course / consent fails on the student_fields check (23514).
  update profiles set role = p_role where id = p_target;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'profile.role_changed', 'profile', p_target::text,
          jsonb_build_object('old', v_old, 'new', p_role));

  return jsonb_build_object('old', v_old, 'new', p_role, 'changed', true);
end $$;

create or replace function admin_set_status(p_actor uuid, p_target uuid, p_status profile_status)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_old  profile_status;
  v_role user_role;
begin
  if p_status not in ('active', 'hidden') then raise exception 'invalid status'; end if;

  perform pg_advisory_xact_lock(hashtext('jadid.admin_changes'));

  if not exists (select 1 from profiles where id = p_actor and role = 'admin' and status = 'active') then
    raise exception 'not an admin';
  end if;

  select status, role into v_old, v_role from profiles where id = p_target for update;
  if not found then raise exception 'user not found'; end if;

  if v_old = p_status then
    return jsonb_build_object('old', v_old, 'new', p_status, 'changed', false);
  end if;

  if v_role = 'admin' and v_old = 'active'
     and not exists (select 1 from profiles where role = 'admin' and status = 'active' and id <> p_target) then
    raise exception 'last admin';
  end if;

  update profiles set status = p_status where id = p_target;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'profile.status_changed', 'profile', p_target::text,
          jsonb_build_object('old', v_old, 'new', p_status));

  return jsonb_build_object('old', v_old, 'new', p_status, 'changed', true);
end $$;

-- 3. Lists for the admin pages. They read auth.users for the email, so they are security definer and
--    callable only with the secret key. The search text is matched literally (% and _ are escaped).
create or replace function admin_list_users(
  p_q      text           default null,
  p_role   user_role      default null,
  p_status profile_status default null,
  p_limit  int            default 50,
  p_offset int            default 0
) returns table (
  id uuid, full_name text, email text, role user_role, status profile_status,
  university text, faculty text, created_at timestamptz, total_count bigint
)
language sql stable security definer set search_path = public, auth as $$
  with q as (
    select nullif(trim(p_q), '') as raw,
           '%' || replace(replace(replace(trim(coalesce(p_q, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select p.id, p.full_name, u.email::text, p.role, p.status, un.name, f.name, p.created_at,
         count(*) over ()
    from profiles p
    join auth.users u on u.id = p.id
    left join universities un on un.id = p.university_id
    left join faculties f on f.id = p.faculty_id
   cross join q
   where (p_role is null or p.role = p_role)
     and (p_status is null or p.status = p_status)
     and (q.raw is null or p.full_name ilike q.pat or u.email ilike q.pat)
   order by p.created_at desc, p.id
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

-- Dates are calendar days in Uzbekistan (Asia/Tashkent); p_to is inclusive.
create or replace function admin_list_audit(
  p_actor  text default null,
  p_action text default null,
  p_from   date default null,
  p_to     date default null,
  p_limit  int  default 50,
  p_offset int  default 0
) returns table (
  id bigint, actor_id uuid, actor_name text, actor_email text, action text, entity text, entity_id text,
  target_name text, details jsonb, created_at timestamptz, total_count bigint
)
language sql stable security definer set search_path = public, auth as $$
  with q as (
    select nullif(trim(p_actor), '') as raw,
           '%' || replace(replace(replace(trim(coalesce(p_actor, '')), '\', '\\'), '%', '\%'), '_', '\_') || '%' as pat
  )
  select a.id, a.actor_id, ap.full_name, au.email::text, a.action, a.entity, a.entity_id,
         tp.full_name, a.details, a.created_at, count(*) over ()
    from audit_log a
    left join profiles ap   on ap.id = a.actor_id
    left join auth.users au on au.id = a.actor_id
    left join profiles tp   on a.entity = 'profile' and tp.id::text = a.entity_id
   cross join q
   where (p_action is null or a.action = p_action)
     and (p_from is null or a.created_at >= (p_from::timestamp at time zone 'Asia/Tashkent'))
     and (p_to   is null or a.created_at <  ((p_to + 1)::timestamp at time zone 'Asia/Tashkent'))
     and (q.raw is null or a.actor_id::text = q.raw or ap.full_name ilike q.pat or au.email ilike q.pat)
   order by a.created_at desc, a.id desc
   limit least(greatest(coalesce(p_limit, 50), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function admin_audit_actions() returns setof text
language sql stable security definer set search_path = public as $$
  select distinct action from audit_log order by 1
$$;

-- 4. Server only (secret key = service_role), like approve_submission() in 20261025000000.
revoke execute on function admin_set_role(uuid, uuid, user_role) from public, anon, authenticated;
revoke execute on function admin_set_status(uuid, uuid, profile_status) from public, anon, authenticated;
revoke execute on function admin_list_users(text, user_role, profile_status, int, int) from public, anon, authenticated;
revoke execute on function admin_list_audit(text, text, date, date, int, int) from public, anon, authenticated;
revoke execute on function admin_audit_actions() from public, anon, authenticated;
grant execute on function admin_set_role(uuid, uuid, user_role) to service_role;
grant execute on function admin_set_status(uuid, uuid, profile_status) to service_role;
grant execute on function admin_list_users(text, user_role, profile_status, int, int) to service_role;
grant execute on function admin_list_audit(text, text, date, date, int, int) to service_role;
grant execute on function admin_audit_actions() to service_role;

-- ------------------------------------------------------------ rubric editor
-- From migration 20261104000000_rubric_editor.sql. The draft journal types (ids 13-16) are seeded there.
create or replace function enforce_active_type() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from achievement_types where id = new.type_id and active) then
    raise exception 'achievement type is not active';
  end if;
  return new;
end $$;

create trigger submissions_type_active before insert on submissions
  for each row execute function enforce_active_type();

-- 4. Rubric changes. Every function: the actor must be an active admin, a reason of 3-200 characters is required,
--    one advisory lock serializes all rubric edits, and every change writes one audit_log row
--    with details {old, new, reason}. Unchanged values write nothing.
create or replace function rubric_guard(p_actor uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := trim(coalesce(p_reason, ''));
begin
  perform pg_advisory_xact_lock(hashtext('jadid.rubric'));
  if not exists (select 1 from profiles where id = p_actor and role = 'admin' and status = 'active') then
    raise exception 'not an admin';
  end if;
  if length(v_reason) < 3 or length(v_reason) > 200 then raise exception 'reason required'; end if;
  return v_reason;
end $$;

-- In use = a submission or a review refers to it. Such types cannot be deleted or switch has_placement,
-- and such cells cannot be removed.
create or replace function rubric_type_in_use(p_type smallint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from submissions where type_id = p_type)
      or exists (select 1 from reviews where final_type_id = p_type)
$$;

create or replace function admin_save_type(
  p_actor         uuid,
  p_id            smallint,      -- null: create a new type
  p_name          jsonb,         -- {"uz": required, "en", "ru": optional}
  p_category      text,
  p_base          int,
  p_has_placement boolean,
  p_proof_hint    text,
  p_cert_required boolean,
  p_reason        text
) returns achievement_types
language plpgsql security definer set search_path = public as $$
declare
  v_reason  text := rubric_guard(p_actor, p_reason);
  v_name    jsonb;
  v_cap     int;
  v_old     achievement_types;
  v_new     achievement_types;
  v_removed jsonb;
begin
  if p_name is null or jsonb_typeof(p_name) <> 'object' or length(trim(coalesce(p_name->>'uz', ''))) = 0 then
    raise exception 'name required';
  end if;
  v_name := jsonb_strip_nulls(jsonb_build_object(
    'uz', trim(p_name->>'uz'),
    'en', nullif(trim(coalesce(p_name->>'en', '')), ''),
    'ru', nullif(trim(coalesce(p_name->>'ru', '')), '')));

  select yearly_cap into v_cap from categories where code = p_category;
  if not found then raise exception 'category not found'; end if;
  if p_base is null or p_base < 0 or p_base > v_cap then raise exception 'points out of range'; end if;
  if p_has_placement is null or p_cert_required is null then raise exception 'invalid value'; end if;
  if exists (select 1 from achievement_types
              where lower(name->>'uz') = lower(v_name->>'uz') and id is distinct from p_id) then
    raise exception 'name taken';
  end if;

  if p_id is null then
    insert into achievement_types (id, category_code, name, base_points, has_placement, proof_hint,
                                   certificate_ref_required, active)
    select coalesce(max(id), 0) + 1, p_category, v_name, p_base, p_has_placement,
           nullif(trim(coalesce(p_proof_hint, '')), ''), p_cert_required, true
      from achievement_types
    returning * into v_new;
    insert into audit_log (actor_id, action, entity, entity_id, details)
    values (p_actor, 'rubric.type_created', 'achievement_type', v_new.id::text,
            jsonb_build_object('old', null, 'new', to_jsonb(v_new), 'reason', v_reason));
    return v_new;
  end if;

  select * into v_old from achievement_types where id = p_id for update;
  if not found then raise exception 'type not found'; end if;

  if v_old.has_placement <> p_has_placement then
    if rubric_type_in_use(p_id) then raise exception 'type has submissions'; end if;
    -- The old cells use the other kind of result, so they go; the admin fills new ones.
    select coalesce(jsonb_agg(to_jsonb(rp) - 'id'), '[]') into v_removed from rubric_points rp where type_id = p_id;
    delete from rubric_points where type_id = p_id;
  elsif exists (select 1 from rubric_points where type_id = p_id and points > v_cap) then
    raise exception 'cap below points';
  end if;

  update achievement_types
     set name = v_name, category_code = p_category, base_points = p_base, has_placement = p_has_placement,
         proof_hint = nullif(trim(coalesce(p_proof_hint, '')), ''), certificate_ref_required = p_cert_required
   where id = p_id
  returning * into v_new;

  if to_jsonb(v_new) is distinct from to_jsonb(v_old) then
    insert into audit_log (actor_id, action, entity, entity_id, details)
    values (p_actor, 'rubric.type_updated', 'achievement_type', p_id::text,
            jsonb_strip_nulls(jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new),
                                                 'reason', v_reason, 'removed_cells', v_removed)));
  end if;
  return v_new;
end $$;

create or replace function admin_set_type_active(p_actor uuid, p_id smallint, p_active boolean, p_reason text)
returns achievement_types
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := rubric_guard(p_actor, p_reason);
  v_old    achievement_types;
  v_new    achievement_types;
begin
  if p_active is null then raise exception 'invalid value'; end if;
  select * into v_old from achievement_types where id = p_id for update;
  if not found then raise exception 'type not found'; end if;
  if v_old.active = p_active then return v_old; end if;

  update achievement_types set active = p_active where id = p_id returning * into v_new;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, case when p_active then 'rubric.type_activated' else 'rubric.type_deactivated' end,
          'achievement_type', p_id::text,
          jsonb_build_object('old', v_old.active, 'new', p_active, 'reason', v_reason));
  return v_new;
end $$;

create or replace function admin_delete_type(p_actor uuid, p_id smallint, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := rubric_guard(p_actor, p_reason);
  v_old    achievement_types;
  v_cells  jsonb;
begin
  select * into v_old from achievement_types where id = p_id for update;
  if not found then raise exception 'type not found'; end if;
  if rubric_type_in_use(p_id) then raise exception 'type has submissions'; end if;

  select coalesce(jsonb_agg(to_jsonb(rp) - 'id'), '[]') into v_cells from rubric_points rp where type_id = p_id;
  delete from rubric_points where type_id = p_id;
  delete from achievement_types where id = p_id;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'rubric.type_deleted', 'achievement_type', p_id::text,
          jsonb_build_object('old', to_jsonb(v_old), 'new', null, 'cells', v_cells, 'reason', v_reason));
end $$;

-- Cells: [{"type_id": 3, "level": "national", "result": "winner", "points": 16}, ...]. points null removes the cell.
-- All or nothing: one bad cell rejects the whole batch. Returns the number of changed cells.
create or replace function admin_set_rubric_points(p_actor uuid, p_cells jsonb, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_reason  text := rubric_guard(p_actor, p_reason);
  c         jsonb;
  v_type    achievement_types;
  v_level   level_t;
  v_result  result_t;
  v_points  int;
  v_cap     int;
  v_old     int;
  v_seen    text[] := '{}';
  v_key     text;
  v_changed int := 0;
begin
  if p_cells is null or jsonb_typeof(p_cells) <> 'array' or jsonb_array_length(p_cells) = 0 then
    raise exception 'invalid cell';
  end if;
  if jsonb_array_length(p_cells) > 200 then raise exception 'too many cells'; end if;

  for c in select value from jsonb_array_elements(p_cells) loop
    if jsonb_typeof(c) <> 'object'
       or jsonb_typeof(c->'type_id') is distinct from 'number'
       or not ((c->>'level') = any (enum_range(null::level_t)::text[]))
       or not ((c->>'result') = any (enum_range(null::result_t)::text[]))
       or jsonb_typeof(c->'points') not in ('number', 'null') then
      raise exception 'invalid cell';
    end if;
    if (c->>'type_id')::numeric <> trunc((c->>'type_id')::numeric) then raise exception 'invalid cell'; end if;
    if jsonb_typeof(c->'points') = 'number'
       and ((c->>'points')::numeric <> trunc((c->>'points')::numeric)
            or (c->>'points')::numeric < 0 or (c->>'points')::numeric > 100000) then
      raise exception 'points out of range';
    end if;

    v_level  := (c->>'level')::level_t;
    v_result := (c->>'result')::result_t;
    v_points := (c->>'points')::int;
    v_key    := (c->>'type_id') || ':' || v_level || ':' || v_result;
    if v_key = any (v_seen) then raise exception 'duplicate cell'; end if;
    v_seen := v_seen || v_key;

    select * into v_type from achievement_types where id = (c->>'type_id')::smallint;
    if not found then raise exception 'type not found'; end if;
    if v_type.has_placement = (v_result = 'confirmed') then raise exception 'result does not fit type'; end if;
    select yearly_cap into v_cap from categories where code = v_type.category_code;
    if v_points is not null and v_points > v_cap then raise exception 'points out of range'; end if;

    select points into v_old from rubric_points
     where type_id = v_type.id and level = v_level and result = v_result for update;
    if not found then v_old := null; end if;
    if v_old is not distinct from v_points then continue; end if;

    if v_points is null then
      if exists (select 1 from submissions where type_id = v_type.id and level = v_level and result = v_result)
         or exists (select 1 from reviews where final_type_id = v_type.id and final_level = v_level and final_result = v_result) then
        raise exception 'cell in use';
      end if;
      delete from rubric_points where type_id = v_type.id and level = v_level and result = v_result;
    elsif v_old is null then
      insert into rubric_points (type_id, level, result, points) values (v_type.id, v_level, v_result, v_points);
    else
      update rubric_points set points = v_points where type_id = v_type.id and level = v_level and result = v_result;
    end if;

    insert into audit_log (actor_id, action, entity, entity_id, details)
    values (p_actor, 'rubric.points_changed', 'rubric_points', v_key,
            jsonb_build_object('old', v_old, 'new', v_points, 'reason', v_reason));
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

create or replace function admin_set_category_cap(p_actor uuid, p_code text, p_cap int, p_reason text) returns categories
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := rubric_guard(p_actor, p_reason);
  v_old    categories;
  v_new    categories;
begin
  if p_cap is null or p_cap < 1 or p_cap > 1000 then raise exception 'cap out of range'; end if;
  select * into v_old from categories where code = p_code for update;
  if not found then raise exception 'category not found'; end if;
  if v_old.yearly_cap = p_cap then return v_old; end if;
  if exists (select 1 from rubric_points rp join achievement_types t on t.id = rp.type_id
              where t.category_code = p_code and rp.points > p_cap)
     or exists (select 1 from achievement_types where category_code = p_code and base_points > p_cap) then
    raise exception 'cap below points';
  end if;

  update categories set yearly_cap = p_cap where code = p_code returning * into v_new;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'rubric.cap_changed', 'category', p_code,
          jsonb_build_object('old', v_old.yearly_cap, 'new', p_cap, 'reason', v_reason));
  return v_new;
end $$;

-- Server only (secret key = service_role).
revoke execute on function rubric_guard(uuid, text) from public, anon, authenticated;
revoke execute on function rubric_type_in_use(smallint) from public, anon, authenticated;
revoke execute on function enforce_active_type() from public, anon, authenticated;
revoke execute on function admin_save_type(uuid, smallint, jsonb, text, int, boolean, text, boolean, text) from public, anon, authenticated;
revoke execute on function admin_set_type_active(uuid, smallint, boolean, text) from public, anon, authenticated;
revoke execute on function admin_delete_type(uuid, smallint, text) from public, anon, authenticated;
revoke execute on function admin_set_rubric_points(uuid, jsonb, text) from public, anon, authenticated;
revoke execute on function admin_set_category_cap(uuid, text, int, text) from public, anon, authenticated;
grant execute on function admin_save_type(uuid, smallint, jsonb, text, int, boolean, text, boolean, text) to service_role;
grant execute on function admin_set_type_active(uuid, smallint, boolean, text) to service_role;
grant execute on function admin_delete_type(uuid, smallint, text) to service_role;
grant execute on function admin_set_rubric_points(uuid, jsonb, text) to service_role;
grant execute on function admin_set_category_cap(uuid, text, int, text) to service_role;

-- ------------------------------------------------------------------ tier editor
-- 3. Tier changes: active admin, reason, one audit_log row with {old, new, reason} (rubric_guard from
--    20261104000000 takes the rubric lock and checks both).
create or replace function tiers_renumber() returns void
language sql security definer set search_path = public as $$
  update tiers t set sort_order = s.rn
    from (select code, row_number() over (order by min_points desc) as rn from tiers) s
   where s.code = t.code and t.sort_order <> s.rn
$$;

create or replace function admin_save_tier(
  p_actor    uuid,
  p_old_code text,   -- null: create
  p_code     text,
  p_label    jsonb,
  p_min      int,
  p_reason   text
) returns tiers
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := rubric_guard(p_actor, p_reason);
  v_code   text := trim(coalesce(p_code, ''));
  v_label  jsonb;
  v_old    tiers;
  v_new    tiers;
begin
  if v_code !~ '^[A-Za-z0-9+-]{1,8}$' then raise exception 'invalid tier code'; end if;
  if p_label is null or jsonb_typeof(p_label) <> 'object' or length(trim(coalesce(p_label->>'uz', ''))) = 0 then
    raise exception 'name required';
  end if;
  v_label := jsonb_strip_nulls(jsonb_build_object(
    'uz', trim(p_label->>'uz'),
    'en', nullif(trim(coalesce(p_label->>'en', '')), ''),
    'ru', nullif(trim(coalesce(p_label->>'ru', '')), '')));
  if p_min is null or p_min < 1 or p_min > 100000 then raise exception 'points out of range'; end if;
  if exists (select 1 from tiers where code = v_code and code is distinct from p_old_code) then
    raise exception 'tier code taken';
  end if;
  if exists (select 1 from tiers where min_points = p_min and code is distinct from p_old_code) then
    raise exception 'tier min taken';
  end if;

  if p_old_code is null then
    insert into tiers (code, label, min_points, sort_order)
    values (v_code, v_label, p_min, (select coalesce(max(sort_order), 0) + 1 from tiers))
    returning * into v_new;
  else
    select * into v_old from tiers where code = p_old_code for update;
    if not found then raise exception 'tier not found'; end if;
    update tiers set code = v_code, label = v_label, min_points = p_min where code = p_old_code
    returning * into v_new;
  end if;

  perform tiers_renumber();
  select * into v_new from tiers where code = v_code;

  if to_jsonb(v_old) is distinct from to_jsonb(v_new) then
    insert into audit_log (actor_id, action, entity, entity_id, details)
    values (p_actor, case when p_old_code is null then 'tier.created' else 'tier.updated' end, 'tier', v_code,
            jsonb_build_object('old', to_jsonb(v_old), 'new', to_jsonb(v_new), 'reason', v_reason));
  end if;
  return v_new;
end $$;

create or replace function admin_delete_tier(p_actor uuid, p_code text, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_reason text := rubric_guard(p_actor, p_reason);
  v_old    tiers;
begin
  select * into v_old from tiers where code = p_code for update;
  if not found then raise exception 'tier not found'; end if;
  if (select count(*) from tiers) <= 1 then raise exception 'last tier'; end if;
  delete from tiers where code = p_code;
  perform tiers_renumber();
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_actor, 'tier.deleted', 'tier', p_code,
          jsonb_build_object('old', to_jsonb(v_old), 'new', null, 'reason', v_reason));
end $$;

-- Server only (secret key = service_role).
revoke execute on function tier_for(int) from public, anon, authenticated;
revoke execute on function tiers_renumber() from public, anon, authenticated;
revoke execute on function admin_save_tier(uuid, text, text, jsonb, int, text) from public, anon, authenticated;
revoke execute on function admin_delete_tier(uuid, text, text) from public, anon, authenticated;
grant execute on function tier_for(int) to service_role;
grant execute on function admin_save_tier(uuid, text, text, jsonb, int, text) to service_role;
grant execute on function admin_delete_tier(uuid, text, text) to service_role;

-- ------------------------------------------------------- file visibility
-- From migration 20261106000000_file_visibility.sql (submissions columns and public_works above).
-- 2. Employers. Created by employer onboarding (create_employer_profile(), 20261107000000). An admin sets
--    verified on /admin/users (admin_set_employer_verified()).
create table employer_profiles (
  profile_id     uuid primary key references profiles(id) on delete cascade,
  verified       boolean not null default false,
  verified_at    timestamptz,
  verified_by    uuid references profiles(id),
  company_name   text,
  contact_person text,
  contact        text,                                   -- phone or Telegram
  created_at     timestamptz not null default now(),
  constraint employer_fields check (
    char_length(trim(company_name)) between 2 and 120
    and char_length(trim(contact_person)) between 2 and 120
    and char_length(trim(contact)) between 3 and 64
  )
);
alter table employer_profiles enable row level security;   -- no policy: server only

-- 3. Rate limit log for /api/files. client_key is 'user:<id>' or an HMAC of the IP (never the raw IP).
--    Rows older than a day are deleted by the route on write.
create table file_access_log (
  id            bigserial primary key,
  submission_id uuid not null,
  viewer_id     uuid references profiles(id) on delete set null,
  client_key    text not null,
  created_at    timestamptz not null default now()
);
create index file_access_log_client_idx on file_access_log (client_key, created_at);
create index file_access_log_created_idx on file_access_log (created_at);
alter table file_access_log enable row level security;     -- no policy: server only

revoke all on employer_profiles, file_access_log from public, anon, authenticated;
grant select, insert, update, delete on employer_profiles, file_access_log to service_role;
grant usage, select on sequence file_access_log_id_seq to service_role;

-- 5. The owner changes the visibility of an approved work. 'public' needs the confirmation checkbox.
create or replace function set_file_visibility(
  p_student    uuid,
  p_submission uuid,
  p_visibility file_visibility_t,
  p_confirm    boolean
) returns submissions
language plpgsql security definer set search_path = public as $$
declare
  s submissions;
begin
  select * into s from submissions where id = p_submission for update;
  if not found or s.student_id is distinct from p_student then raise exception 'submission not found'; end if;
  if s.status <> 'approved' then raise exception 'submission is not approved'; end if;
  if s.sensitive_data_flag then raise exception 'file is flagged as sensitive'; end if;
  if p_visibility = 'public' and coalesce(p_confirm, false) is not true then raise exception 'confirmation required'; end if;
  if s.file_visibility = p_visibility then return s; end if;

  update submissions
     set file_visibility = p_visibility,
         public_confirmed_at = case when p_visibility = 'public' then now() else null end
   where id = p_submission
  returning * into s;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, 'submission.visibility', 'submission', s.id::text,
          jsonb_build_object('visibility', p_visibility, 'confirmed_at', s.public_confirmed_at));
  return s;
end $$;

-- 6. A reviewer or admin flags (or unflags) a document as showing sensitive data. Flagging makes it private.
--    Unflagging leaves it private; the student may choose again.
create or replace function set_sensitive_flag(
  p_reviewer   uuid,
  p_submission uuid,
  p_flag       boolean
) returns submissions
language plpgsql security definer set search_path = public as $$
declare
  s submissions;
begin
  if not exists (select 1 from profiles
                 where id = p_reviewer and role in ('reviewer', 'admin') and status = 'active') then
    raise exception 'not an active reviewer';
  end if;
  select * into s from submissions where id = p_submission for update;
  if not found then raise exception 'submission not found'; end if;
  if s.student_id = p_reviewer then raise exception 'reviewers cannot review their own submissions'; end if;
  if s.sensitive_data_flag = coalesce(p_flag, false) then return s; end if;

  update submissions
     set sensitive_data_flag = coalesce(p_flag, false),
         file_visibility = case when p_flag then 'private' else file_visibility end,
         public_confirmed_at = case when p_flag then null else public_confirmed_at end
   where id = p_submission
  returning * into s;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_reviewer, 'submission.sensitive_flag', 'submission', s.id::text, jsonb_build_object('flag', s.sensitive_data_flag));
  return s;
end $$;

-- Server only (secret key = service_role).
revoke execute on function set_file_visibility(uuid, uuid, file_visibility_t, boolean) from public, anon, authenticated;
revoke execute on function set_sensitive_flag(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function set_file_visibility(uuid, uuid, file_visibility_t, boolean) to service_role;
grant execute on function set_sensitive_flag(uuid, uuid, boolean) to service_role;

-- ------------------------------------------------- employers and talent
-- From migration 20261107000000_employers_talent.sql (enums, profiles.open_to_work and employer_profiles above).
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

  insert into employer_profiles (profile_id, company_name, contact_person, contact, verified)
  values (p_user, trim(p_company), trim(p_person), trim(p_contact), false);

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
revoke execute on function create_employer_profile(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function set_open_to_work(uuid, boolean) from public, anon, authenticated;
revoke execute on function admin_set_employer_verified(uuid, uuid, boolean) from public, anon, authenticated;
revoke execute on function create_contact_request(uuid, uuid, text, int) from public, anon, authenticated;
revoke execute on function respond_contact_request(uuid, uuid, boolean, contact_kind, text) from public, anon, authenticated;
revoke execute on function talent_directory(int, text, text) from public, anon, authenticated;
grant execute on function create_employer_profile(uuid, text, text, text, text) to service_role;
grant execute on function set_open_to_work(uuid, boolean) to service_role;
grant execute on function admin_set_employer_verified(uuid, uuid, boolean) to service_role;
grant execute on function create_contact_request(uuid, uuid, text, int) to service_role;
grant execute on function respond_contact_request(uuid, uuid, boolean, contact_kind, text) to service_role;
grant execute on function talent_directory(int, text, text) to service_role;

-- ------------------------------------------------------------------------ CV
-- From migrations 20261108000000_student_cv.sql and 20261108000001_fix_save_cv.sql (CLAUDE.md rule 12).
create type cv_visibility_t as enum ('private', 'verified', 'public');

-- 1. Validation helpers. Immutable (no clock): the "not in the future" month check is in save_cv().
--    A text value: a JSON string, trimmed length between min and max, no control characters (newlines only where
--    allowed). Lengths are in characters (code points), the same as the zod schema on the server.
create or replace function cv_text_ok(v jsonb, min_len int, max_len int, allow_newlines boolean default false)
returns boolean
language sql immutable set search_path = public as $$
  select jsonb_typeof(v) = 'string'
     and char_length(v #>> '{}') between min_len and max_len
     and (min_len = 0 or char_length(btrim(v #>> '{}')) >= min_len)
     and case when allow_newlines then replace(v #>> '{}', E'\n', '') else v #>> '{}' end !~ '[[:cntrl:]]'
$$;

create or replace function cv_keys_are(e jsonb, keys text[]) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if jsonb_typeof(e) is distinct from 'object' then
    return false;
  end if;
  return (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(e) k)
       = (select array_agg(k order by k) from unnest(keys) k);
end $$;

-- skills:     ["SQL", ...]                                   at most 20, each 1-40, no duplicates (case-insensitive)
-- languages:  [{name, level}]                                at most 8, name 1-40, level A1..C2 or native
-- experience: [{title, organization, start, end, description}] at most 10, title and organization 1-120,
--             start 'YYYY-MM', end 'YYYY-MM' or null (= present) and not before start, description 0-300
-- links:      [{label, url}]                                 at most 5, label 1-40, url https:// only, 300 max,
--             no user:password@ part, a dotted host
create or replace function cv_content_valid(skills jsonb, languages jsonb, experience jsonb, links jsonb)
returns boolean
language plpgsql immutable set search_path = public as $$
declare
  e     jsonb;
  month constant text := '^(19[5-9][0-9]|20[0-9][0-9])-(0[1-9]|1[0-2])$';
begin
  -- Each type is checked before any array function runs (SQL "and" does not promise to short-circuit).
  if jsonb_typeof(skills) is distinct from 'array' or jsonb_typeof(languages) is distinct from 'array'
     or jsonb_typeof(experience) is distinct from 'array' or jsonb_typeof(links) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(skills) > 20 or jsonb_array_length(languages) > 8
     or jsonb_array_length(experience) > 10 or jsonb_array_length(links) > 5 then
    return false;
  end if;

  for e in select * from jsonb_array_elements(skills) loop
    if not coalesce(cv_text_ok(e, 1, 40), false) then return false; end if;
  end loop;
  if (select count(distinct lower(x #>> '{}')) from jsonb_array_elements(skills) x) <> jsonb_array_length(skills) then
    return false;
  end if;

  for e in select * from jsonb_array_elements(languages) loop
    if not coalesce(cv_keys_are(e, array['name', 'level'])
                    and cv_text_ok(e -> 'name', 1, 40)
                    and jsonb_typeof(e -> 'level') = 'string'
                    and e ->> 'level' in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'), false) then
      return false;
    end if;
  end loop;

  for e in select * from jsonb_array_elements(experience) loop
    if not coalesce(cv_keys_are(e, array['title', 'organization', 'start', 'end', 'description']), false) then
      return false;
    end if;
    if not coalesce(cv_text_ok(e -> 'title', 1, 120)
                    and cv_text_ok(e -> 'organization', 1, 120)
                    and cv_text_ok(e -> 'description', 0, 300, true)
                    and jsonb_typeof(e -> 'start') = 'string'
                    and (e ->> 'start') ~ month, false) then
      return false;
    end if;
    if jsonb_typeof(e -> 'end') <> 'null'
       and not coalesce(jsonb_typeof(e -> 'end') = 'string' and (e ->> 'end') ~ month and e ->> 'end' >= e ->> 'start', false) then
      return false;
    end if;
  end loop;

  for e in select * from jsonb_array_elements(links) loop
    if not coalesce(cv_keys_are(e, array['label', 'url'])
                    and cv_text_ok(e -> 'label', 1, 40)
                    and cv_text_ok(e -> 'url', 12, 300)
                    and (e ->> 'url') ~ '^https://[^[:space:]/?#@\\]+\.[^[:space:]/?#@\\]+([/?#][^[:space:]]*)?$', false) then
      return false;
    end if;
  end loop;
  return true;
end $$;

-- 2. The CV. A row is created on the first save (or the first visibility change).
create table student_cvs (
  student_id             uuid primary key references profiles(id) on delete cascade,
  about                  text  not null default '' check (char_length(about) <= 600),
  skills                 jsonb not null default '[]',
  languages              jsonb not null default '[]',
  experience             jsonb not null default '[]',
  links                  jsonb not null default '[]',
  -- Contact fields of the CV, separate from the sign-in email; all optional. Shown only to the owner, admins and
  -- employers with an accepted contact request (rule 12). Never written to audit_log.
  contact_phone          text check (contact_phone is null or contact_phone ~ '^\+?[0-9][0-9 ()-]{6,19}$'),
  contact_email          text check (contact_email is null
                                     or (char_length(contact_email) <= 254 and contact_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  contact_telegram       text check (contact_telegram is null or contact_telegram ~ '^@?[A-Za-z0-9_]{5,32}$'),
  contact_city           text check (contact_city is null
                                     or (char_length(btrim(contact_city)) between 2 and 80 and contact_city !~ '[[:cntrl:]]')),
  cv_visibility          cv_visibility_t not null default 'private',
  cv_public_confirmed_at timestamptz,
  write_window_start     timestamptz,                -- rate limit: start of the current one-hour window
  write_count            int not null default 0,     -- writes in that window (save_cv and set_cv_visibility)
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint cv_about_text      check (replace(about, E'\n', '') !~ '[[:cntrl:]]'),
  constraint cv_public_confirmed check (cv_visibility <> 'public' or cv_public_confirmed_at is not null),
  constraint cv_content_valid   check (cv_content_valid(skills, languages, experience, links))
);
alter table student_cvs enable row level security;   -- no policy: server only

revoke all on student_cvs from public, anon, authenticated;
grant select, insert, update, delete on student_cvs to service_role;

-- 3. Rate limit shared by both writers: 60 writes per student per one-hour window. Caller holds the row lock.
create or replace function cv_count_write(p_student uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  c student_cvs;
begin
  select * into c from student_cvs where student_id = p_student;
  if c.write_window_start is null or c.write_window_start < now() - interval '1 hour' then
    update student_cvs set write_window_start = now(), write_count = 1 where student_id = p_student;
  elsif c.write_count >= 60 then
    raise exception 'rate_limited';
  else
    update student_cvs set write_count = write_count + 1 where student_id = p_student;
  end if;
end $$;

-- 4. The student saves the whole CV (not the visibility). p_doc has exactly these keys:
--    about, skills, languages, experience, links, contact_phone, contact_email, contact_telegram, contact_city.
--    Empty contact strings are stored as null. Audit records only which sections changed, never the text.
create or replace function save_cv(p_student uuid, p_doc jsonb) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare
  c        student_cvs;
  v_month  text := to_char(now() at time zone 'Asia/Tashkent', 'YYYY-MM');
  v_about  text;
  v_phone  text;
  v_email  text;
  v_tg     text;
  v_city   text;
  v_changed text[] := '{}';
  v_at     timestamptz;
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student' and status = 'active') then
    raise exception 'not_active_student';
  end if;
  if not cv_keys_are(p_doc, array['about', 'skills', 'languages', 'experience', 'links',
                                  'contact_phone', 'contact_email', 'contact_telegram', 'contact_city']) then
    raise exception 'invalid_cv';
  end if;
  if jsonb_typeof(p_doc -> 'about') <> 'string'
     or exists (select 1 from unnest(array['contact_phone', 'contact_email', 'contact_telegram', 'contact_city']) k
                 where jsonb_typeof(p_doc -> k) not in ('string', 'null')) then
    raise exception 'invalid_cv';
  end if;
  -- No experience may start or end after the current month ("present" covers ongoing work).
  if jsonb_typeof(p_doc -> 'experience') = 'array' then
    if exists (select 1 from jsonb_array_elements(p_doc -> 'experience') e
                where jsonb_typeof(e) = 'object'
                  and (coalesce(e ->> 'start', '') > v_month or coalesce(e ->> 'end', '') > v_month)) then
      raise exception 'invalid_cv';
    end if;
  end if;

  v_about := p_doc ->> 'about';
  v_phone := nullif(btrim(coalesce(p_doc ->> 'contact_phone', '')), '');
  v_email := nullif(btrim(coalesce(p_doc ->> 'contact_email', '')), '');
  v_tg    := nullif(btrim(coalesce(p_doc ->> 'contact_telegram', '')), '');
  v_city  := nullif(btrim(coalesce(p_doc ->> 'contact_city', '')), '');

  insert into student_cvs (student_id) values (p_student) on conflict (student_id) do nothing;
  select * into c from student_cvs where student_id = p_student for update;
  perform cv_count_write(p_student);

  if c.about is distinct from v_about then v_changed := array_append(v_changed, 'about'); end if;
  if c.skills is distinct from p_doc -> 'skills' then v_changed := array_append(v_changed, 'skills'); end if;
  if c.languages is distinct from p_doc -> 'languages' then v_changed := array_append(v_changed, 'languages'); end if;
  if c.experience is distinct from p_doc -> 'experience' then v_changed := array_append(v_changed, 'experience'); end if;
  if c.links is distinct from p_doc -> 'links' then v_changed := array_append(v_changed, 'links'); end if;
  if (c.contact_phone, c.contact_email, c.contact_telegram, c.contact_city)
     is distinct from (v_phone, v_email, v_tg, v_city) then
    v_changed := array_append(v_changed, 'contacts');
  end if;

  begin
    update student_cvs
       set about = v_about, skills = p_doc -> 'skills', languages = p_doc -> 'languages',
           experience = p_doc -> 'experience', links = p_doc -> 'links',
           contact_phone = v_phone, contact_email = v_email, contact_telegram = v_tg, contact_city = v_city,
           updated_at = case when cardinality(v_changed) > 0 then now() else updated_at end
     where student_id = p_student
    returning updated_at into v_at;
  exception when check_violation or not_null_violation or invalid_text_representation or invalid_parameter_value then
    raise exception 'invalid_cv';
  end;

  if cardinality(v_changed) > 0 then
    insert into audit_log (actor_id, action, entity, entity_id, details)
    values (p_student, 'cv.updated', 'profile', p_student::text, jsonb_build_object('sections', to_jsonb(v_changed)));
  end if;
  return v_at;
end $$;

-- 5. The student changes who may open the CV. 'public' needs the confirmation checkbox and stores when it was given.
create or replace function set_cv_visibility(p_student uuid, p_visibility cv_visibility_t, p_confirm boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c     student_cvs;
  v_old cv_visibility_t;
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student' and status = 'active') then
    raise exception 'not_active_student';
  end if;
  if p_visibility is null then raise exception 'invalid_cv'; end if;
  if p_visibility = 'public' and coalesce(p_confirm, false) is not true then raise exception 'confirmation_required'; end if;

  insert into student_cvs (student_id) values (p_student) on conflict (student_id) do nothing;
  select * into c from student_cvs where student_id = p_student for update;
  if c.cv_visibility = p_visibility then
    return jsonb_build_object('visibility', c.cv_visibility, 'public_confirmed_at', c.cv_public_confirmed_at);
  end if;
  perform cv_count_write(p_student);
  v_old := c.cv_visibility;

  update student_cvs
     set cv_visibility = p_visibility,
         cv_public_confirmed_at = case when p_visibility = 'public' then now() else null end
   where student_id = p_student
  returning * into c;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, 'cv.visibility', 'profile', p_student::text,
          jsonb_build_object('old', v_old, 'new', p_visibility, 'confirmed_at', c.cv_public_confirmed_at));
  return jsonb_build_object('visibility', c.cv_visibility, 'public_confirmed_at', c.cv_public_confirmed_at);
end $$;

-- 6. Server only (secret key = service_role).
revoke execute on function cv_count_write(uuid) from public, anon, authenticated;
revoke execute on function save_cv(uuid, jsonb) from public, anon, authenticated;
revoke execute on function set_cv_visibility(uuid, cv_visibility_t, boolean) from public, anon, authenticated;
grant execute on function cv_count_write(uuid) to service_role;
grant execute on function save_cv(uuid, jsonb) to service_role;
grant execute on function set_cv_visibility(uuid, cv_visibility_t, boolean) to service_role;
