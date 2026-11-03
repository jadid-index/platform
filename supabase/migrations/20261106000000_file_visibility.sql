-- File visibility (6 Nov). Proof files stay in the private 'proofs' bucket. The student chooses per approved work who
-- may open the document; GET /api/files/:id checks that and hands out a 60-second signed URL (CLAUDE.md rule 4).
--   private:  owner, reviewers, admins
--   verified: also employers whose employer_profiles.verified = true
--   public:   anyone, after the student confirmed the document shows no sensitive data (public_confirmed_at)
-- A reviewer can flag a document as showing sensitive data; a flagged file is private and cannot be made visible.

-- 1. Submissions.
create type file_visibility_t as enum ('private', 'verified', 'public');

alter table submissions
  add column file_visibility     file_visibility_t not null default 'verified',
  add column sensitive_data_flag boolean not null default false,
  add column public_confirmed_at timestamptz,
  add constraint submissions_public_confirmed check (file_visibility <> 'public' or public_confirmed_at is not null),
  add constraint submissions_sensitive_private check (not sensitive_data_flag or file_visibility = 'private');

-- 2. Employers. Verification is set by an admin later (no UI yet). Nobody is verified now.
create table employer_profiles (
  profile_id  uuid primary key references profiles(id) on delete cascade,
  verified    boolean not null default false,
  verified_at timestamptz,
  verified_by uuid references profiles(id)
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

-- 4. Public works: issuer and certificate reference are public now (consent v2), plus whether the file is public.
--    Never the file path, the raw visibility or the sensitive flag. New columns are appended (create or replace).
create or replace view public_works as
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

revoke all on public_works from public, anon, authenticated;
grant select on public_works to service_role;

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
