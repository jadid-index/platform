-- Tiers (5 Nov). The public sees a tier, never points, ranks or approval order (CLAUDE.md rule 11).
-- Exact points stay in reviews (snapshots) and go only to the owner, reviewers and admins.

-- 1. Tiers. Placeholders for a yearly maximum of 4 categories x 100 = 400 points. Admins edit them on
--    /admin/rubric. sort_order (1 = best) is always renumbered from min_points, so the two can never disagree.
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

-- 2. Public views, rebuilt without points, rank, approval times or course. They stay server-only
--    (20261025000000): the app reads them with the secret key and returns the public fields.
drop view leaderboard;
drop view leaderboard_by_year;
drop view public_works;

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

-- Approved works on a public profile: level and result, never points or the file.
create view public_works as
select r.student_id,
       s.id               as submission_id,
       s.title,
       r.final_type_id    as type_id,
       t.name             as type_name,
       r.final_level      as level,
       r.final_result     as result,
       s.achievement_date
  from reviews r
  join submissions s       on s.id = r.submission_id
  join achievement_types t on t.id = r.final_type_id
 where r.decision = 'approved';

revoke all on leaderboard, leaderboard_by_year, public_works from public, anon, authenticated;
grant select on leaderboard, leaderboard_by_year, public_works to service_role;

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
