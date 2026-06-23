-- Slack messaging channel — workspace OAuth connections + event dedupe.
-- One Slack workspace per WiseCall account; each connection maps to one agent.

create table if not exists wisecall_messaging_connections (
  id                uuid primary key default gen_random_uuid(),
  owner_id          uuid not null,
  profile_id        uuid not null,
  provider          text not null check (provider in ('slack', 'teams')),
  workspace_id      text not null,
  workspace_name    text,
  bot_token         text not null,
  bot_user_id       text,
  installer_user_id text,
  scopes            text,
  status            text not null default 'connected', -- connected | revoked | error
  last_error        text,
  metadata          jsonb not null default '{}',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (owner_id, provider),
  unique (workspace_id, provider)
);

create index if not exists wisecall_messaging_connections_profile
  on wisecall_messaging_connections (profile_id);

create index if not exists wisecall_messaging_connections_workspace
  on wisecall_messaging_connections (workspace_id, provider)
  where status = 'connected';

-- Slack Events API delivers at-least-once; claim event_id before replying.
create table if not exists wisecall_slack_processed (
  event_id    text primary key,
  created_at  timestamptz not null default now()
);
