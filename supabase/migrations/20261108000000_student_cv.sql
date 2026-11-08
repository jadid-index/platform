-- Student CV (8 Nov). One CV per student, typed by the student ("self-declared"), plus education from the profile
-- and the approved works (read at view time, never copied here). CLAUDE.md rule 12: private by default; the contact
-- fields reach only an employer whose contact request the student accepted; never sent to the AI model.
--   private:  owner, admins, employers with an accepted request
--   verified: also employers whose employer_profiles.verified = true (without contact fields)
--   public:   anyone (without contact fields and without the course), after the confirmation dialog
-- Who may open what is decided on the server (src/lib/cv-access.ts); this migration stores and validates.

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
language sql immutable set search_path = public as $$
  select jsonb_typeof(e) = 'object'
     and (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(e) k)
       = (select array_agg(k order by k) from unnest(keys) k)
$$;

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

  if c.about is distinct from v_about then v_changed := v_changed || 'about'; end if;
  if c.skills is distinct from p_doc -> 'skills' then v_changed := v_changed || 'skills'; end if;
  if c.languages is distinct from p_doc -> 'languages' then v_changed := v_changed || 'languages'; end if;
  if c.experience is distinct from p_doc -> 'experience' then v_changed := v_changed || 'experience'; end if;
  if c.links is distinct from p_doc -> 'links' then v_changed := v_changed || 'links'; end if;
  if (c.contact_phone, c.contact_email, c.contact_telegram, c.contact_city)
     is distinct from (v_phone, v_email, v_tg, v_city) then
    v_changed := v_changed || 'contacts';
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
