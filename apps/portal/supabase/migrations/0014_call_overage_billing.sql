-- AI call overage billing
-- Tracks per-period call usage against each plan's included allowance.
-- Mirrors the email channel pattern (email_used_period / email_overage_period).
-- Overage is billed automatically via invoice.created Stripe webhook.

alter table public.wisecall_billing
  add column if not exists calls_monthly_allowance integer not null default 0,
  add column if not exists calls_used_period       integer not null default 0,
  add column if not exists calls_overage_period    integer not null default 0,
  add column if not exists calls_period_end        timestamptz;

-- Atomically record one completed AI call against the account owner's allowance.
-- Called from the call-completed webhook with the profile_id of the agent that took the call.
-- Returns a usage snapshot for logging.
create or replace function public.wisecall_record_ai_call(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_plan   text;
  v_status text;
  v_allow  integer;
  v_used   integer;
  v_over   integer;
begin
  -- Resolve owner from profile metadata
  select (metadata->>'owner_id')::uuid into v_owner
  from public.wisecall_profiles
  where id = p_profile_id;

  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_owner');
  end if;

  select plan, status, calls_monthly_allowance, calls_used_period, calls_overage_period
    into v_plan, v_status, v_allow, v_used, v_over
  from public.wisecall_billing
  where user_id = v_owner;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_billing');
  end if;

  -- Count calls on active and trialing plans only
  if v_status not in ('active', 'trialing') then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', v_status);
  end if;

  v_allow := coalesce(v_allow, 0);
  v_used  := coalesce(v_used, 0);
  v_over  := coalesce(v_over, 0);

  if v_allow > 0 and v_used >= v_allow then
    -- Past the included allowance - overage
    update public.wisecall_billing
      set calls_overage_period = v_over + 1,
          updated_at = now()
    where user_id = v_owner;
    v_over := v_over + 1;
  else
    update public.wisecall_billing
      set calls_used_period = v_used + 1,
          updated_at = now()
    where user_id = v_owner;
    v_used := v_used + 1;
  end if;

  return jsonb_build_object(
    'ok',        true,
    'counted',   true,
    'plan',      v_plan,
    'used',      v_used,
    'allowance', v_allow,
    'overage',   v_over
  );
end;
$$;

grant execute on function public.wisecall_record_ai_call(uuid) to service_role;

-- Backfill calls_monthly_allowance for any existing subscribers based on their plan.
-- New plans: starter=100, professional=300, business=750.
-- Legacy plans kept at 0 (overage tracking was never active for them).
update public.wisecall_billing
set calls_monthly_allowance = case plan
  when 'starter'      then 100
  when 'professional' then 300
  when 'business'     then 750
  else 0
end
where plan in ('starter', 'professional', 'business');
