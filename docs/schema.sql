-- Jadid Index MVP schema (v0.3)
-- PostgreSQL 15+, written for Supabase (uses auth.users and auth.uid()).
-- All writes go through the server API with the service-role key.
-- The browser only reads what the RLS policies at the bottom allow.

-- ---------------------------------------------------------------- enums
create type user_role         as enum ('student', 'reviewer', 'admin');
create type profile_status    as enum ('pending', 'active', 'rejected');
create type level_t           as enum ('university', 'national', 'international');
create type result_t          as enum ('participant', 'finalist', 'winner', 'confirmed');
create type submission_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

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
  name           text not null unique,
  base_points    int  not null check (base_points >= 0),
  has_placement  boolean not null default false,     -- true: participant / finalist / winner
  proof_hint     text                                -- what the reviewer checks
);

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
  university_id   int  not null references universities(id),
  faculty_id      int  references faculties(id),
  course          smallint check (course between 1 and 6),
  role            user_role      not null default 'student',
  status          profile_status not null default 'active',    -- active once the university email is verified; pending/rejected are for admin use
  photo_path      text,
  bio             text check (char_length(bio) <= 300),
  telegram        text,
  consent_version text,
  consent_at      timestamptz,
  created_at      timestamptz not null default now(),
  constraint student_fields check (
    role <> 'student'
    or (faculty_id is not null and course is not null
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

-- ----------------------------------------------------------------- views
-- Public leaderboard. Rank is computed by the API after filtering, for example:
--   select *, row_number() over (order by total_points desc, last_approved_at asc) as rank
--   from leaderboard where university_id = $1 and faculty_id = $2;
create or replace view leaderboard as
select p.id                               as student_id,
       p.full_name,
       p.photo_path,
       p.course,
       p.university_id,
       u.name                             as university,
       p.faculty_id,
       f.name                             as faculty,
       coalesce(sum(r.points_awarded), 0)::int as total_points,
       count(r.id)::int                   as approved_count,
       max(r.reviewed_at)                 as last_approved_at
from profiles p
join universities u on u.id = p.university_id
left join faculties f on f.id = p.faculty_id
left join reviews r on r.student_id = p.id and r.decision = 'approved'
where p.role = 'student' and p.status = 'active'
group by p.id, u.name, f.name;

-- Points per academic year (2026 = 2026/27). Counting starts in 2023, so older students hold several
-- years of points. Use this view for a "this academic year" leaderboard; students with no approved
-- work in a year do not appear in it.
create or replace view leaderboard_by_year as
select p.id                               as student_id,
       p.full_name,
       p.photo_path,
       p.course,
       p.university_id,
       u.name                             as university,
       p.faculty_id,
       f.name                             as faculty,
       r.academic_year,
       sum(r.points_awarded)::int         as total_points,
       count(r.id)::int                   as approved_count,
       max(r.reviewed_at)                 as last_approved_at
from profiles p
join universities u on u.id = p.university_id
left join faculties f on f.id = p.faculty_id
join reviews r on r.student_id = p.id and r.decision = 'approved'
where p.role = 'student' and p.status = 'active'
group by p.id, u.name, f.name, r.academic_year;

-- What a visitor sees after clicking a student: approved works only, never the file.
create or replace view public_works as
select r.student_id,
       s.id               as submission_id,
       s.title,
       t.name             as type_name,
       r.final_level      as level,
       r.final_result     as result,
       r.points_awarded,
       s.achievement_date
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
-- The views run with the owner's rights, so grant them explicitly.
-- The consent text says name, faculty, score (and photo) are public, so anon may read them.
-- Decided: the leaderboard is visible without login.
revoke all on leaderboard, leaderboard_by_year, public_works from public;
grant select on leaderboard, leaderboard_by_year, public_works to anon, authenticated;
