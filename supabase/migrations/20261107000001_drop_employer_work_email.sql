-- Drop employer_profiles.work_email (7 Nov). The account email from sign-up already identifies the employer, and
-- admins see it on /admin/users; sign-up now asks employers to register with their work email instead.

-- 1. The onboarding function without the work email parameter.
drop function create_employer_profile(uuid, text, text, text, text, text);

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

revoke execute on function create_employer_profile(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function create_employer_profile(uuid, text, text, text, text) to service_role;

-- 2. The check without work_email, then the column. NOT VALID as before (older rows are test data).
alter table employer_profiles drop constraint employer_fields;
alter table employer_profiles add constraint employer_fields check (
  char_length(trim(company_name)) between 2 and 120
  and char_length(trim(contact_person)) between 2 and 120
  and char_length(trim(contact)) between 3 and 64
) not valid;
alter table employer_profiles drop column work_email;
