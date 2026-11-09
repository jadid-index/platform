-- Uploaded CV (9 Nov). A student may attach one PDF CV next to the typed one (student_cvs). It follows the same
-- cv_visibility and the same access matrix (cvAccess() in src/lib/cv-access.ts, CLAUDE.md rule 12). Apply by hand
-- in the SQL editor (never supabase db push).
--
-- Upload flow (as for proofs; Vercel limits request bodies to 4.5 MB):
--   1. the server checks the student, the declared type and size, calls cv_file_issue() and returns a one-time
--      upload URL for cvs/{student_id}/{id}.pdf;
--   2. the browser uploads straight to storage;
--   3. the server downloads and screens the file, then cv_file_finalize() (or cv_file_reject() and deletes it).
-- Every object ever created has a row here, so the cleanup (cv_file_stale()) needs no access to the storage schema.

-- 1. Private bucket. The size and type limits are a second guard; the server checks the real bytes.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cvs', 'cvs', false, 5242880, '{application/pdf}')
on conflict (id) do nothing;

-- 2. One row per object.
--    pending: upload URL issued, not finalized (cleanup deletes it after 1 hour)
--    current: the student's uploaded CV (at most one per student)
--    removed: replaced, deleted or refused; the object is deleted, then the row (cv_file_forget())
create table cv_files (
  id           uuid primary key,
  student_id   uuid references profiles(id) on delete set null,   -- null after an account is deleted: cleanup removes it
  object_name  text not null unique,                               -- {student_id}/{id}.pdf; server only, never returned
  file_name    text not null check (char_length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]]'),
  size_bytes   int check (size_bytes between 1 and 5242880),
  state        text not null default 'pending' check (state in ('pending', 'current', 'removed')),
  created_at   timestamptz not null default now(),
  finalized_at timestamptz,
  removed_at   timestamptz,
  constraint cv_files_current_complete check (state <> 'current' or (size_bytes is not null and finalized_at is not null))
);
create unique index cv_files_one_current on cv_files (student_id) where state = 'current';
create index cv_files_student_created on cv_files (student_id, created_at);
create index cv_files_state_created on cv_files (state, created_at);
alter table cv_files enable row level security;   -- no policy: server only

-- 3. Rate limit of GET /api/cv/:studentId/file (like file_access_log for proofs). Rows older than a day are deleted.
create table cv_file_access_log (
  id         bigserial primary key,
  student_id uuid not null,
  viewer_id  uuid references profiles(id) on delete set null,
  client_key text not null,
  created_at timestamptz not null default now()
);
create index cv_file_access_log_client_idx on cv_file_access_log (client_key, created_at);
create index cv_file_access_log_created_idx on cv_file_access_log (created_at);
alter table cv_file_access_log enable row level security;   -- no policy: server only

revoke all on cv_files, cv_file_access_log from public, anon, authenticated;
grant select, insert, update, delete on cv_files, cv_file_access_log to service_role;
grant usage, select on sequence cv_file_access_log_id_seq to service_role;

-- 4. Step 1: reserve an object for an active student. At most 10 per student per hour.
create or replace function cv_file_issue(p_student uuid, p_id uuid, p_object text, p_file_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student' and status = 'active') then
    raise exception 'not_active_student';
  end if;
  -- The object name is built by the server; checked again so no other folder can be reserved.
  if p_object is distinct from p_student::text || '/' || p_id::text || '.pdf' then
    raise exception 'invalid_body';
  end if;
  perform pg_advisory_xact_lock(hashtext('cv_file_issue:' || p_student::text));
  if (select count(*) from cv_files where student_id = p_student and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate_limited';
  end if;
  insert into cv_files (id, student_id, object_name, file_name) values (p_id, p_student, p_object, p_file_name);
exception when check_violation then
  raise exception 'invalid_body';
end $$;

-- 5. Step 3 (after the server screened the bytes): the pending object becomes the student's CV file. The previous
--    one is marked removed and its object name returned, so the server deletes it. While the CV is public, the
--    student must have confirmed that the file may be seen by anyone.
create or replace function cv_file_finalize(p_student uuid, p_id uuid, p_size int, p_confirm_public boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f     cv_files;
  v_old cv_files;
begin
  if not exists (select 1 from profiles where id = p_student and role = 'student' and status = 'active') then
    raise exception 'not_active_student';
  end if;
  perform pg_advisory_xact_lock(hashtext('cv_file:' || p_student::text));
  select * into f from cv_files where id = p_id and student_id = p_student for update;
  if f.id is null or f.state <> 'pending' then raise exception 'invalid_upload'; end if;
  if f.created_at < now() - interval '1 hour' then raise exception 'upload_expired'; end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then raise exception 'file_too_large'; end if;
  if exists (select 1 from student_cvs where student_id = p_student and cv_visibility = 'public')
     and coalesce(p_confirm_public, false) is not true then
    raise exception 'file_confirmation_required';
  end if;

  update cv_files set state = 'removed', removed_at = now()
   where student_id = p_student and state = 'current'
  returning * into v_old;
  update cv_files set state = 'current', size_bytes = p_size, finalized_at = now() where id = p_id returning * into f;

  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, 'cv.file_uploaded', 'profile', p_student::text,
          jsonb_build_object('size', p_size, 'replaced', v_old.id is not null));
  return jsonb_build_object('file_name', f.file_name, 'size', f.size_bytes, 'uploaded_at', f.finalized_at,
                            'old_id', v_old.id, 'old_object', v_old.object_name);
end $$;

-- 6. A pending upload that failed the screen: marked removed (the server deletes the object, then forgets the row).
create or replace function cv_file_reject(p_student uuid, p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update cv_files set state = 'removed', removed_at = now()
   where id = p_id and student_id = p_student and state = 'pending';
end $$;

-- 7. The student deletes the uploaded CV. Returns the object to delete (null when there was none). Allowed for any
--    status: a blocked student may still remove their own file.
create or replace function cv_file_remove(p_student uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  f cv_files;
begin
  perform pg_advisory_xact_lock(hashtext('cv_file:' || p_student::text));
  update cv_files set state = 'removed', removed_at = now()
   where student_id = p_student and state = 'current'
  returning * into f;
  if f.id is null then return null; end if;
  insert into audit_log (actor_id, action, entity, entity_id, details)
  values (p_student, 'cv.file_deleted', 'profile', p_student::text, '{}'::jsonb);
  return jsonb_build_object('id', f.id, 'object', f.object_name);
end $$;

-- 8. The object of a removed row is gone: drop the row, but only once its upload URL can no longer be used.
--    Supabase's signed upload URL is valid for 2 hours (not configurable), so a late upload could recreate the
--    object after it was deleted; until 3 hours have passed the row stays and each cleanup run deletes it again.
create or replace function cv_file_forget(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from cv_files
   where id = p_id and (state = 'removed' or student_id is null) and created_at < now() - interval '3 hours';
end $$;

-- 9. Cleanup: what may be deleted from the bucket. Pending uploads older than p_older_than (never finalized),
--    removed rows whose object deletion failed earlier, and rows of deleted accounts. Marks them removed.
create or replace function cv_file_stale(p_older_than interval default interval '1 hour', p_limit int default 500)
returns table (id uuid, object_name text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with stale as (
    select c.id from cv_files c
     where (c.state = 'pending' and c.created_at < now() - p_older_than)
        or c.state = 'removed'
        or c.student_id is null
     order by c.created_at
     limit p_limit
     for update skip locked
  )
  update cv_files c set state = 'removed', removed_at = coalesce(c.removed_at, now())
    from stale where c.id = stale.id
  returning c.id, c.object_name;
end $$;

-- 10. set_cv_visibility() gains p_confirm_file: making the CV public while an uploaded file exists also needs the
--     second confirmation ("the file may contain phone, address or ID details"). Everything else is unchanged.
drop function if exists set_cv_visibility(uuid, cv_visibility_t, boolean);
create or replace function set_cv_visibility(p_student uuid, p_visibility cv_visibility_t, p_confirm boolean,
                                             p_confirm_file boolean default false)
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

  -- Serialized with cv_file_finalize(), so a file cannot slip in between this check and the update.
  perform pg_advisory_xact_lock(hashtext('cv_file:' || p_student::text));
  insert into student_cvs (student_id) values (p_student) on conflict (student_id) do nothing;
  select * into c from student_cvs where student_id = p_student for update;
  if c.cv_visibility = p_visibility then
    return jsonb_build_object('visibility', c.cv_visibility, 'public_confirmed_at', c.cv_public_confirmed_at);
  end if;
  if p_visibility = 'public' and coalesce(p_confirm_file, false) is not true
     and exists (select 1 from cv_files where student_id = p_student and state = 'current') then
    raise exception 'file_confirmation_required';
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

-- 11. Server only (secret key = service_role).
revoke execute on function cv_file_issue(uuid, uuid, text, text) from public, anon, authenticated;
revoke execute on function cv_file_finalize(uuid, uuid, int, boolean) from public, anon, authenticated;
revoke execute on function cv_file_reject(uuid, uuid) from public, anon, authenticated;
revoke execute on function cv_file_remove(uuid) from public, anon, authenticated;
revoke execute on function cv_file_forget(uuid) from public, anon, authenticated;
revoke execute on function cv_file_stale(interval, int) from public, anon, authenticated;
revoke execute on function set_cv_visibility(uuid, cv_visibility_t, boolean, boolean) from public, anon, authenticated;
grant execute on function cv_file_issue(uuid, uuid, text, text) to service_role;
grant execute on function cv_file_finalize(uuid, uuid, int, boolean) to service_role;
grant execute on function cv_file_reject(uuid, uuid) to service_role;
grant execute on function cv_file_remove(uuid) to service_role;
grant execute on function cv_file_forget(uuid) to service_role;
grant execute on function cv_file_stale(interval, int) to service_role;
grant execute on function set_cv_visibility(uuid, cv_visibility_t, boolean, boolean) to service_role;
