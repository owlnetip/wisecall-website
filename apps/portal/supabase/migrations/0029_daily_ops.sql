-- Daily Ops: prioritised follow-ups, contact case memory, status flags, digest tracking.

-- ── Follow-ups: priority, category, real snooze ──────────────────────────────
alter table wisecall_follow_ups
  add column if not exists priority text not null default 'normal';

alter table wisecall_follow_ups
  add column if not exists category text not null default 'admin';

alter table wisecall_follow_ups
  add column if not exists snoozed_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wisecall_follow_ups_priority_check'
  ) then
    alter table wisecall_follow_ups
      add constraint wisecall_follow_ups_priority_check
      check (priority in ('critical', 'high', 'normal', 'low'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'wisecall_follow_ups_category_check'
  ) then
    alter table wisecall_follow_ups
      add constraint wisecall_follow_ups_category_check
      check (category in ('lead', 'sales', 'complaint', 'booking', 'callback', 'admin'));
  end if;
end $$;

create index if not exists wisecall_follow_ups_profile_open_priority
  on wisecall_follow_ups (profile_id, status, priority, due_at)
  where status in ('open', 'snoozed');

-- ── Contacts: structured case memory for continuity greeting ─────────────────
alter table wisecall_contacts
  add column if not exists relationship_status text;

alter table wisecall_contacts
  add column if not exists open_case_summary text;

alter table wisecall_contacts
  add column if not exists key_facts jsonb not null default '[]'::jsonb;

alter table wisecall_contacts
  add column if not exists last_outcome text;

alter table wisecall_contacts
  add column if not exists priority_score int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wisecall_contacts_relationship_check'
  ) then
    alter table wisecall_contacts
      add constraint wisecall_contacts_relationship_check
      check (
        relationship_status is null
        or relationship_status in ('lead', 'customer', 'complaint', 'vendor', 'unknown')
      );
  end if;
end $$;

-- ── Caller / company status flags (accounts holds, VIP, custom gates) ────────
create table if not exists wisecall_status_flags (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null,
  contact_id          uuid references wisecall_contacts(id) on delete set null,
  match_phone         text,
  match_email         text,
  match_company       text,
  flag_key            text not null,
  label               text not null,
  policy              text not null default 'warn',
  agent_message       text not null default '',
  transfer_route_key  text,
  applies_when        text[] not null default array['all']::text[],
  active              boolean not null default true,
  source              text not null default 'manual',
  external_ref        text,
  expires_at          timestamptz,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint wisecall_status_flags_policy_check
    check (policy in ('warn', 'soft_block', 'hard_route', 'allow_with_note')),
  constraint wisecall_status_flags_source_check
    check (source in ('manual', 'csv', 'webhook'))
);

create index if not exists wisecall_status_flags_profile_active
  on wisecall_status_flags (profile_id, active)
  where active = true;

create index if not exists wisecall_status_flags_phone
  on wisecall_status_flags (profile_id, match_phone)
  where match_phone is not null and match_phone != '';

create index if not exists wisecall_status_flags_email
  on wisecall_status_flags (profile_id, match_email)
  where match_email is not null and match_email != '';

create index if not exists wisecall_status_flags_company
  on wisecall_status_flags (profile_id, match_company)
  where match_company is not null and match_company != '';

create index if not exists wisecall_status_flags_contact
  on wisecall_status_flags (contact_id)
  where contact_id is not null;

alter table wisecall_status_flags enable row level security;

-- ── Ops digest send log (idempotent morning/afternoon slots) ─────────────────
create table if not exists wisecall_ops_digest_sends (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null,
  slot         text not null,
  local_date   text not null,
  item_count   int not null default 0,
  item_ids     uuid[] not null default '{}',
  sent_at      timestamptz not null default now(),
  constraint wisecall_ops_digest_sends_slot_check
    check (slot in ('morning', 'afternoon')),
  constraint wisecall_ops_digest_sends_unique
    unique (profile_id, slot, local_date)
);

create index if not exists wisecall_ops_digest_sends_profile
  on wisecall_ops_digest_sends (profile_id, sent_at desc);

alter table wisecall_ops_digest_sends enable row level security;
