-- Legacy email channel billing columns, retained for bundled email usage tracking.
-- Tracked on wisecall_billing; enforced in wisecall-email-inbound edge function.

alter table public.wisecall_billing
  add column if not exists email_channel_enabled boolean not null default false,
  add column if not exists email_channel_subscription_id text,
  add column if not exists email_channel_status text,
  add column if not exists email_monthly_allowance integer not null default 100,
  add column if not exists email_used_period integer not null default 0,
  add column if not exists email_overage_period integer not null default 0,
  add column if not exists email_period_end timestamptz;

-- Atomically record one AI email reply against the account owner's allowance.
-- Returns usage snapshot for logging. Fail-soft on missing billing row.
create or replace function public.wisecall_record_email_reply(p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_status  text;
  v_allow   integer;
  v_used    integer;
  v_over    integer;
begin
  select email_channel_enabled, email_channel_status, email_monthly_allowance, email_used_period, email_overage_period
    into v_enabled, v_status, v_allow, v_used, v_over
  from public.wisecall_billing
  where user_id = p_owner;

  if not found then
    return jsonb_build_object('allowed', false, 'reason', 'no_billing');
  end if;

  if not coalesce(v_enabled, false) or v_status is distinct from 'active' then
    return jsonb_build_object('allowed', false, 'reason', 'not_subscribed');
  end if;

  v_allow := coalesce(v_allow, 100);
  v_used := coalesce(v_used, 0);
  v_over := coalesce(v_over, 0);

  if v_used >= v_allow then
    update public.wisecall_billing
      set email_overage_period = v_over + 1,
          updated_at = now()
    where user_id = p_owner;
    v_over := v_over + 1;
  else
    update public.wisecall_billing
      set email_used_period = v_used + 1,
          updated_at = now()
    where user_id = p_owner;
    v_used := v_used + 1;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'used', v_used,
    'allowance', v_allow,
    'overage', v_over,
    'in_overage', v_used > v_allow or (v_used = v_allow and v_over > 0)
  );
end;
$$;

grant execute on function public.wisecall_record_email_reply(uuid) to service_role;
