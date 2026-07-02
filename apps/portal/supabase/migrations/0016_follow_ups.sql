-- Post-call follow-up tasks extracted by AI or added manually.
-- Scoped per agent (profile_id); optionally linked to contact and call log.

create table if not exists wisecall_follow_ups (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null,
  contact_id    uuid references wisecall_contacts(id) on delete set null,
  call_log_id   uuid references wisecall_call_logs(id) on delete set null,
  title         text not null,
  description   text,
  source        text not null default 'ai',
  status        text not null default 'open',
  due_at        timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint wisecall_follow_ups_status_check
    check (status in ('open', 'done', 'snoozed')),
  constraint wisecall_follow_ups_source_check
    check (source in ('ai', 'manual'))
);

create index if not exists wisecall_follow_ups_profile_status
  on wisecall_follow_ups (profile_id, status, created_at desc);

create index if not exists wisecall_follow_ups_contact_id
  on wisecall_follow_ups (contact_id)
  where contact_id is not null;

create index if not exists wisecall_follow_ups_call_log_id
  on wisecall_follow_ups (call_log_id)
  where call_log_id is not null;
