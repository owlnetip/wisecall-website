-- One row per website "Call me" ring-back that Telnyx accepted, so campaign
-- links (/try?src=email → source try_email) can be counted per source.
-- Written only by the wisecall-demo-callback edge function (service role).

create table if not exists public.wisecall_demo_callbacks (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  phone text not null,
  source text not null default '',
  profile_slug text not null,
  call_sid text
);

create index if not exists wisecall_demo_callbacks_source_created_idx
  on public.wisecall_demo_callbacks (source, created_at desc);

-- Holds lead phone numbers: service role only, no anon/authenticated access.
alter table public.wisecall_demo_callbacks enable row level security;
revoke all on public.wisecall_demo_callbacks from anon, authenticated;
