-- Atomic claim/release for the number pool, so concurrent agent-creates can't
-- grab the same free number (FOR UPDATE SKIP LOCKED). Service-role only.

create or replace function public.wisecall_assign_pool_number(p_profile_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_number text;
begin
  update wisecall_number_pool
    set status = 'assigned', assigned_profile_id = p_profile_id,
        assigned_at = now(), released_at = null, updated_at = now()
  where id = (
    select id from wisecall_number_pool
    where status = 'free' order by created_at
    for update skip locked limit 1
  )
  returning phone_number into v_number;
  return v_number; -- null when the pool is empty
end; $$;

create or replace function public.wisecall_release_pool_number(p_profile_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_number text;
begin
  update wisecall_number_pool
    set status = 'free', assigned_profile_id = null, assigned_at = null,
        released_at = now(), updated_at = now()
  where assigned_profile_id = p_profile_id and status = 'assigned'
  returning phone_number into v_number;
  return v_number;
end; $$;

grant execute on function public.wisecall_assign_pool_number(uuid) to service_role;
grant execute on function public.wisecall_release_pool_number(uuid) to service_role;
