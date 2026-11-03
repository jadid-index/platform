-- Admin area, part 2 (3 Nov): student-only profile fields, role / status changes with audit, admin lists.

-- 1. University, faculty and course are needed for students only. Employers, reviewers and admins may have none.
--    A student row must still have all of them (and the consent).
alter table profiles alter column university_id drop not null;
alter table profiles drop constraint student_fields;
alter table profiles add constraint student_fields check (
  role <> 'student'
  or (university_id is not null and faculty_id is not null and course is not null
      and consent_version is not null and consent_at is not null)
);

comment on column profiles.status is
  'active by default; an admin sets hidden on /admin/users to remove a person from public views. pending / rejected are legacy and also hidden';

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
