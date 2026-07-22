-- Property CRM connectors (Reapit, Street, AgentOS, Dezrez, Jupix).

create table if not exists wisecall_crm_connections (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  provider        text not null
    check (provider in ('reapit', 'street', 'agentos', 'dezrez', 'jupix')),
  status          text not null default 'connected'
    check (status in ('connected', 'disconnected', 'error')),
  access_token    text,
  refresh_token   text,
  account_label   text,
  config          jsonb not null default '{}'::jsonb,
  last_sync_at    timestamptz,
  last_sync_error text,
  last_sync_count integer,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, provider)
);

create index if not exists wisecall_crm_connections_profile_idx
  on wisecall_crm_connections (profile_id);

alter table wisecall_crm_connections enable row level security;
revoke all on public.wisecall_crm_connections from anon, authenticated;
