-- Tighten the runtime billing gate used before an AI call starts.
--
-- Trialing customers can answer calls until they hit the trial cap. Active
-- customers are always allowed. Canceled, paused, unpaid, past_due, or otherwise
-- inactive billing states must not keep answering calls.

create or replace function public.wisecall_call_allowed(p_profile_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_cap     integer;
  v_count   integer;
  v_blocked boolean;
begin
  select coalesce((metadata ->> 'trial_blocked')::boolean, false)
    into v_blocked
  from public.wisecall_profiles
  where id = p_profile_id;

  if v_blocked then
    return false;
  end if;

  v_owner := public.wisecall_profile_owner(p_profile_id);
  if v_owner is null then
    return true;
  end if;

  select status, trial_call_cap
    into v_status, v_cap
  from public.wisecall_billing
  where user_id = v_owner;

  -- Preserve legacy/no-billing behavior: the runtime should not break profiles
  -- where billing has never been provisioned.
  if not found then
    return true;
  end if;

  if v_status = 'active' then
    return true;
  end if;

  if v_status is distinct from 'trialing' then
    return false;
  end if;

  v_cap := coalesce(v_cap, 20);
  v_count := public.wisecall_owner_call_count(v_owner);
  return v_count < v_cap;
end;
$$;

grant execute on function public.wisecall_call_allowed(uuid) to service_role;
