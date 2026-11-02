-- Property listings mirrored from a portal (Rightmove) for agents that sell or
-- let property. wisecall-listing-sync fills them on a schedule, and the chat and
-- voice agents read them to confirm which listing a caller means before taking
-- an offer or viewing request (wisecall-find-listing / _shared/property-listings.ts).
--
-- Service role only: nothing reads these through the anon key or a user JWT.

create table if not exists public.property_listing_feeds (
  profile_id uuid primary key references public.wisecall_profiles(id) on delete cascade,
  provider text not null default 'rightmove' check (provider in ('rightmove')),
  search_url text not null,          -- results URL with {index} where the page offset goes
  kb_prefix text,                    -- e.g. 'bettermove-rm': also keep the agent's KB docs in step
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_count integer,
  last_error text,
  kb_doc_hashes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.property_listings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.wisecall_profiles(id) on delete cascade,
  provider text not null default 'rightmove',
  listing_id text not null,
  display_address text not null,
  street text,                       -- everything before the town, e.g. 'Flat 2, Mill Court, Station Road'
  town text,
  postcode_district text,
  price integer,
  price_label text,
  price_qualifier text,
  bedrooms integer,
  bathrooms integer,
  property_type text,
  status text not null default 'FOR SALE',
  url text not null,
  summary text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  removed_at timestamptz,
  unique (profile_id, provider, listing_id)
);

create index if not exists property_listings_profile_active_idx
  on public.property_listings (profile_id) where removed_at is null;

alter table public.property_listing_feeds enable row level security;
alter table public.property_listings enable row level security;

revoke all on public.property_listing_feeds from anon, authenticated;
revoke all on public.property_listings from anon, authenticated;
grant select, insert, update, delete on public.property_listing_feeds to service_role;
grant select, insert, update, delete on public.property_listings to service_role;
