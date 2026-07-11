-- Weekly agent learning: suggestions distilled from recent call analysis.
-- Human-in-the-loop: pending → approved (applied to agent) or dismissed.

create table if not exists wisecall_agent_learning (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  owner_id        uuid not null,
  week_start      date not null,
  status          text not null default 'pending',
  summary         text,
  calls_analysed  integer not null default 0,
  suggestions     jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz,
  applied_at      timestamptz,
  constraint wisecall_agent_learning_status_check
    check (status in ('pending', 'approved', 'dismissed', 'applied')),
  constraint wisecall_agent_learning_week_unique
    unique (profile_id, week_start)
);

create index if not exists wisecall_agent_learning_owner_status
  on wisecall_agent_learning (owner_id, status, created_at desc);

create index if not exists wisecall_agent_learning_profile
  on wisecall_agent_learning (profile_id, created_at desc);
