-- Self-serve pooled phone-number provisioning. Pre-bought GB numbers sit here as
-- 'free'; on first agent creation a free one is assigned (pure DB — the numbers
-- already point at the shared TeXML app and the runtime routes by called number),
-- and is reclaimed to 'free' on agent delete / subscription cancel for reuse.

create table if not exists wisecall_number_pool (
  id                  uuid primary key default gen_random_uuid(),
  phone_number        text not null unique,          -- E.164, e.g. +441135220425
  telnyx_id           text,                           -- Telnyx phone number id
  area_code           text,                           -- e.g. 113 (Leeds)
  country             text not null default 'GB',
  status              text not null default 'free'
                        check (status in ('free', 'assigned', 'pending', 'retired')),
  assigned_profile_id uuid,
  assigned_at         timestamptz,
  released_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists wisecall_number_pool_status on wisecall_number_pool (status);
create index if not exists wisecall_number_pool_profile
  on wisecall_number_pool (assigned_profile_id) where assigned_profile_id is not null;
