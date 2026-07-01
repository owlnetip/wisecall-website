-- WiseCall portal: self-serve billing + free-trial call cap
-- Project: zgzzpwaqqftmugzpccpm ("My Project")
-- Apply in Supabase Studio → SQL editor, or via `supabase db push`.
--
-- Adds:
--   1. public.wisecall_billing        - one row per customer (auth user)
--   2. trigger on wisecall_call_logs  - auto-disables a trialing customer's
--                                       agents once they hit their call cap
--   3. wisecall_call_allowed(uuid)    - guard the phone runtime calls at call-start

-- ── 1. Billing table ────────────────────────────────────────────────────────
create table if not exists public.wisecall_billing (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id   text,
  subscription_id      text,
  plan                 text,                       -- e.g. 'payg'
  status               text,                       -- trialing | active | past_due | canceled | unpaid
  trial_end            timestamptz,
  current_period_end   timestamptz,
  trial_call_cap       integer not null default 20,
  updated_at           timestamptz not null default now()
);

create index if not exists wisecall_billing_stripe_customer_idx
  on public.wisecall_billing (stripe_customer_id);

-- The portal reads/writes this only with the service role, so RLS stays off
-- (consistent with wisecall_profiles). The anon key can't see it because no
-- policy grants access once RLS is considered; keep it locked down:
alter table public.wisecall_billing enable row level security;
-- (No policies → only service_role, which bypasses RLS, can touch it.)

-- ── helper: resolve the owner (auth user) of a profile ──────────────────────
create or replace function public.wisecall_profile_owner(p_profile_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select (metadata ->> 'owner_id')::uuid
  from public.wisecall_profiles
  where id = p_profile_id;
$$;

-- ── helper: count an owner's total AI calls ─────────────────────────────────
create or replace function public.wisecall_owner_call_count(p_owner uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::int
  from public.wisecall_call_logs cl
  where cl.profile_id in (
    select id from public.wisecall_profiles
    where metadata ->> 'owner_id' = p_owner::text
  );
$$;

-- ── 2. Enforce the trial cap on every new call log ──────────────────────────
create or replace function public.wisecall_enforce_trial_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner  uuid;
  v_status text;
  v_cap    integer;
  v_count  integer;
begin
  v_owner := public.wisecall_profile_owner(new.profile_id);
  if v_owner is null then
    return new;
  end if;

  select status, trial_call_cap
    into v_status, v_cap
  from public.wisecall_billing
  where user_id = v_owner;

  -- Only trialing customers are capped. Paid/active customers are never blocked.
  if v_status is distinct from 'trialing' then
    return new;
  end if;

  v_cap := coalesce(v_cap, 20);
  v_count := public.wisecall_owner_call_count(v_owner);

  if v_count >= v_cap then
    -- Backstop for runtimes that skip inactive agents, plus an explicit flag
    -- the runtime / portal can read.
    update public.wisecall_profiles
      set is_active = false,
          metadata  = jsonb_set(coalesce(metadata, '{}'::jsonb), '{trial_blocked}', 'true'::jsonb)
    where metadata ->> 'owner_id' = v_owner::text;
  end if;

  return new;
end;
$$;

drop trigger if exists wisecall_trial_cap_trigger on public.wisecall_call_logs;
create trigger wisecall_trial_cap_trigger
  after insert on public.wisecall_call_logs
  for each row
  execute function public.wisecall_enforce_trial_cap();

-- ── 3. Guard the phone runtime calls at call-start ──────────────────────────
-- Returns false when the agent's owner is on a free trial and has hit the cap
-- (or has been flagged blocked). Returns true otherwise - including for paid
-- customers and agents with no billing record (so nothing breaks if billing is
-- absent). Call this from the runtime before answering; refuse the call on false.
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

  if v_status is distinct from 'trialing' then
    return true; -- not on a trial → uncapped
  end if;

  v_cap := coalesce(v_cap, 20);
  v_count := public.wisecall_owner_call_count(v_owner);
  return v_count < v_cap;
end;
$$;

grant execute on function public.wisecall_call_allowed(uuid) to service_role;
