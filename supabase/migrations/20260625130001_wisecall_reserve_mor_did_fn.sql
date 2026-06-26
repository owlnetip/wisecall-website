-- Atomically reserves the next available MOR DID for a profile.
-- Uses FOR UPDATE SKIP LOCKED so concurrent provisioning calls don't double-assign.
-- Returns the reserved row, or an empty result if the pool is exhausted.
create or replace function public.wisecall_reserve_mor_did(p_profile_id uuid)
returns setof public.wisecall_mor_ddi_pool
language plpgsql
security definer
as $$
declare
  v_row public.wisecall_mor_ddi_pool;
begin
  select * into v_row
  from public.wisecall_mor_ddi_pool
  where status = 'available'
  order by did_number
  limit 1
  for update skip locked;

  if not found then
    return;
  end if;

  update public.wisecall_mor_ddi_pool
    set status = 'reserved', profile_id = p_profile_id
  where id = v_row.id;

  v_row.status := 'reserved';
  v_row.profile_id := p_profile_id;
  return next v_row;
end;
$$;

grant execute on function public.wisecall_reserve_mor_did(uuid) to service_role;
