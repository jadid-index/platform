-- Fixes for 20261108000000 (8 Nov). Nothing else changes.
-- 1. cv_keys_are() called jsonb_object_keys() on non-objects too (SQL "and" does not short-circuit), which raised
--    an error instead of returning false (for example for a body that is an array). Now plpgsql with an early return.
-- 2. save_cv(): `text[] || 'about'` parsed 'about' as an array literal ("malformed array literal"), so every save
--    failed. Same function, with array_append().

create or replace function cv_keys_are(e jsonb, keys text[]) returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if jsonb_typeof(e) is distinct from 'object' then
    return false;
  end if;
  return (select coalesce(array_agg(k order by k), '{}') from jsonb_object_keys(e) k)
       = (select array_agg(k order by k) from unnest(keys) k);
end $$;

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

revoke execute on function save_cv(uuid, jsonb) from public, anon, authenticated;
grant execute on function save_cv(uuid, jsonb) to service_role;
