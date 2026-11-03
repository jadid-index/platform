-- Rubric editor (4 Nov). Admins change types, points and yearly caps on /admin/rubric, only through the
-- functions below. A change never touches existing reviews: approve_submission() copies the points into
-- reviews.rubric_points / points_awarded at approval time (snapshot). Pending submissions get the rubric as it
-- is when they are approved. docs/seed.sql stays the original seed; after the first edit the database is the
-- source of truth.

-- 1. Type names become an object, one key per language: {"uz": "...", "en": "..."} ("uz" is required).
--    public_works depends on the column, so it is dropped here and recreated below.
drop view public_works;

alter table achievement_types drop constraint achievement_types_name_key;
alter table achievement_types alter column name type jsonb using jsonb_build_object('en', name);

update achievement_types t
   set name = t.name || jsonb_build_object('uz', v.uz)
  from (values
    (1,  'Jurnal maqolasi'),
    (2,  'Konferensiya maqolasi yoki tezisi'),
    (3,  'Olimpiada yoki ilmiy tanlov'),
    (4,  'Patent (ixtiro, foydali model, sanoat namunasi)'),
    (5,  'Dasturiy taʼminot yoki maʼlumotlar bazasi guvohnomasi'),
    (6,  'Ishlaydigan mahsulotga ega startap loyiha'),
    (7,  'Olingan grant'),
    (8,  'Xakaton'),
    (9,  'Volontyorlik (har bir sertifikat)'),
    (10, 'Talabalar loyihasi yoki klubiga rahbarlik'),
    (11, 'Professional kurs sertifikati'),
    (12, 'Kitob oʻqish tanlovi (har bir kitob)')
  ) as v(id, uz)
 where t.id = v.id;
-- Any type not listed above (none in the seed) gets its English name as the Uzbek one, so the check holds.
update achievement_types set name = name || jsonb_build_object('uz', name->>'en') where not (name ? 'uz');

alter table achievement_types add constraint achievement_types_name_check
  check (jsonb_typeof(name) = 'object' and length(trim(coalesce(name->>'uz', ''))) > 0);
create unique index achievement_types_name_uz_uq on achievement_types (lower(name->>'uz'));

-- 2. Inactive types are hidden from the student form and cannot be submitted. They stay for existing work.
--    certificate_ref_required replaces the check by type name (names are editable now).
alter table achievement_types
  add column active boolean not null default true,
  add column certificate_ref_required boolean not null default false;
update achievement_types set certificate_ref_required = true where id = 1;

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

-- 3. public_works again, now with type_id (the type is already public) and the name object.
create view public_works as
select r.student_id,
       s.id               as submission_id,
       s.title,
       r.final_type_id    as type_id,
       t.name             as type_name,
       r.final_level      as level,
       r.final_result     as result,
       r.points_awarded,
       s.achievement_date
from reviews r
join submissions s       on s.id = r.submission_id
join achievement_types t on t.id = r.final_type_id
where r.decision = 'approved';

-- Same access as after 20261025000000: the server reads it with the secret key, the browser roles cannot.
revoke all on public_works from public, anon, authenticated;
grant select on public_works to service_role;

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

-- 5. DRAFT: finer journal article types, inactive until an admin reviews the points on /admin/rubric and
--    switches them on (and, if wanted, switches the general "Journal article" off).
insert into achievement_types (id, category_code, name, base_points, has_placement, proof_hint, active, certificate_ref_required) values
  (13, 'scientific', '{"uz": "Jurnal maqolasi: Scopus / Web of Science", "en": "Journal article: Scopus / Web of Science indexed"}',
   60, false, 'DOI and the journal''s current Scopus or Web of Science record.', false, true),
  (14, 'scientific', '{"uz": "Jurnal maqolasi: OAK roʻyxatidagi jurnal", "en": "Journal article: VAK (OAK) listed journal"}',
   30, false, 'Journal is on the current OAK (VAK) list for the article''s year; DOI or journal page.', false, true),
  (15, 'scientific', '{"uz": "Jurnal maqolasi: boshqa milliy jurnal", "en": "Journal article: other national journal"}',
   12, false, 'Journal page or issue with the article; not on the OAK list.', false, true),
  (16, 'scientific', '{"uz": "Jurnal maqolasi: boshqa xalqaro jurnal", "en": "Journal article: other international journal"}',
   24, false, 'DOI or journal page; journal is not indexed in Scopus or Web of Science.', false, true);

insert into rubric_points (type_id, level, result, points) values
  (13, 'international', 'confirmed', 60),
  (14, 'national', 'confirmed', 30),
  (15, 'national', 'confirmed', 12),
  (16, 'international', 'confirmed', 24);

insert into audit_log (actor_id, action, entity, entity_id, details)
select null, 'rubric.type_created', 'achievement_type', t.id::text,
       jsonb_build_object('old', null, 'new', to_jsonb(t), 'reason', 'Draft seed (migration 20261104000000), inactive until reviewed')
  from achievement_types t where t.id between 13 and 16;
