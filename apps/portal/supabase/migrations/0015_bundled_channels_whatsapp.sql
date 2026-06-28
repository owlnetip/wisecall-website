-- Single-platform model: AI email is bundled into every plan; WhatsApp + live chat
-- added as bundled channels with their own
-- monthly allowances. Mirrors the call/email usage pattern (migration 0014 / 0005).

-- 1. WhatsApp + live-chat usage columns on wisecall_billing
alter table public.wisecall_billing
  add column if not exists whatsapp_monthly_allowance integer not null default 0,
  add column if not exists whatsapp_used_period       integer not null default 0,
  add column if not exists whatsapp_overage_period    integer not null default 0,
  add column if not exists whatsapp_period_end        timestamptz,
  add column if not exists livechat_monthly_allowance integer not null default 0,
  add column if not exists livechat_used_period       integer not null default 0,
  add column if not exists livechat_overage_period    integer not null default 0;

-- 2. Per-customer WhatsApp number registry (one Meta WABA number per agent).
--    The inbound webhook resolves the receiving phone_number_id -> profile.
create table if not exists public.wisecall_whatsapp_numbers (
  phone_number_id   text primary key,            -- Meta WhatsApp phone_number_id
  profile_id        uuid not null references public.wisecall_profiles(id) on delete cascade,
  whatsapp_number   text,                         -- E.164 display number
  display_name      text,
  waba_id           text,                         -- Meta WhatsApp Business Account id
  status            text not null default 'active',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists wisecall_whatsapp_numbers_profile_idx
  on public.wisecall_whatsapp_numbers (profile_id);

alter table public.wisecall_whatsapp_numbers enable row level security;
-- Service role (edge fns / webhook) bypasses RLS; no public policies needed.

-- 3. Atomically record one AI WhatsApp message against the owner's allowance.
create or replace function public.wisecall_record_whatsapp_message(p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_status text;
  v_allow  integer;
  v_used   integer;
  v_over   integer;
begin
  select (metadata->>'owner_id')::uuid into v_owner
  from public.wisecall_profiles where id = p_profile_id;
  if v_owner is null then
    return jsonb_build_object('ok', false, 'reason', 'no_owner');
  end if;

  select status, whatsapp_monthly_allowance, whatsapp_used_period, whatsapp_overage_period
    into v_status, v_allow, v_used, v_over
  from public.wisecall_billing where user_id = v_owner;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_billing');
  end if;
  if v_status not in ('active', 'trialing') then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', v_status);
  end if;

  v_allow := coalesce(v_allow, 0);
  v_used  := coalesce(v_used, 0);
  v_over  := coalesce(v_over, 0);

  if v_allow > 0 and v_used >= v_allow then
    update public.wisecall_billing
      set whatsapp_overage_period = v_over + 1, updated_at = now()
    where user_id = v_owner;
    v_over := v_over + 1;
  else
    update public.wisecall_billing
      set whatsapp_used_period = v_used + 1, updated_at = now()
    where user_id = v_owner;
    v_used := v_used + 1;
  end if;

  return jsonb_build_object('ok', true, 'counted', true,
    'used', v_used, 'allowance', v_allow, 'overage', v_over);
end;
$$;

grant execute on function public.wisecall_record_whatsapp_message(uuid) to service_role;

-- 4. Backfill: email is now bundled, so enable it + set per-plan allowances for
--    every existing active/trialing plan.
update public.wisecall_billing
set email_channel_enabled = true,
    email_channel_status  = 'active',
    email_monthly_allowance = case plan
      when 'starter' then 100 when 'professional' then 500 when 'business' then 2000 else email_monthly_allowance end,
    whatsapp_monthly_allowance = case plan
      when 'starter' then 100 when 'professional' then 500 when 'business' then 2000 else 0 end,
    livechat_monthly_allowance = case plan
      when 'starter' then 100 when 'professional' then 500 when 'business' then 2000 else 0 end,
    whatsapp_period_end = current_period_end
where status in ('active', 'trialing')
  and plan in ('starter', 'professional', 'business');
