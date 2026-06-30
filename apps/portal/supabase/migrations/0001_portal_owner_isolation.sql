-- WiseCall portal: per-customer agent ownership
-- Project: zgzzpwaqqftmugzpccpm  ("My Project")
-- Apply in Supabase Studio → SQL editor, or via `supabase db push`.
--
-- PART 1 is additive and safe to run on production: it only adds a nullable
-- column + index. The live phone runtime (service role) is unaffected, and
-- existing rows simply have a NULL owner until you assign them.

-- ── PART 1: ownership column (SAFE) ─────────────────────────────────────────
alter table public.wisecall_profiles
  add column if not exists owner_id uuid references auth.users (id) on delete set null;

create index if not exists wisecall_profiles_owner_id_idx
  on public.wisecall_profiles (owner_id);

-- Assign existing agents to a customer once they have an account, e.g.:
--   update public.wisecall_profiles
--   set owner_id = '<auth-user-uuid>'
--   where slug in ('home-cloud', 'rinsedental');


-- ── PART 2: Row Level Security (OPTIONAL / HARDENING) ───────────────────────
-- ⚠ READ BEFORE RUNNING. The anon (public) API key can currently read every
-- row of wisecall_profiles (including secrets like dentally_api_key). If the
-- live Lovable portal / demo pages rely on that anon access, enabling the
-- policies below WILL break them until those apps are updated to authenticate.
-- The portal itself does NOT need this - it already scopes every query by
-- owner_id server-side with the service role. Enable this only once you've
-- confirmed nothing else depends on anon reads.
--
-- alter table public.wisecall_profiles enable row level security;
--
-- -- Authenticated customers can see/manage only their own agents.
-- create policy "owner can read own agents"
--   on public.wisecall_profiles for select
--   to authenticated using (owner_id = auth.uid());
--
-- create policy "owner can update own agents"
--   on public.wisecall_profiles for update
--   to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
--
-- create policy "owner can insert own agents"
--   on public.wisecall_profiles for insert
--   to authenticated with check (owner_id = auth.uid());
--
-- Note: the service_role key bypasses RLS, so the phone runtime keeps working.
