-- Contact memory table. One row per unique caller per agent (keyed on profile_id+phone
-- or profile_id+email). The voice runtime upserts here after every call; the portal
-- reads it for the Contacts view. call_count/email_count are maintained by the runtime,
-- not a trigger, so they can increment efficiently without a full table scan.

create table if not exists wisecall_contacts (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null,                          -- which agent
  phone         text,                                   -- normalised E.164
  email         text,
  name          text,                                   -- resolved from caller ID or self-reported
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  call_count    int not null default 0,
  email_count   int not null default 0,
  ai_summary    text,                                   -- auto-generated after each interaction
  notes         text,                                   -- human-editable in portal
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Unique per agent+phone and per agent+email (partial: nulls are never unique)
create unique index if not exists wisecall_contacts_profile_phone
  on wisecall_contacts (profile_id, phone)
  where phone is not null and phone != '';

create unique index if not exists wisecall_contacts_profile_email
  on wisecall_contacts (profile_id, email)
  where email is not null and email != '';

create index if not exists wisecall_contacts_profile_id  on wisecall_contacts (profile_id);
create index if not exists wisecall_contacts_last_seen   on wisecall_contacts (last_seen desc);

-- Link call logs back to the contact (runtime fills this in post-call)
alter table wisecall_call_logs
  add column if not exists contact_id uuid references wisecall_contacts(id) on delete set null;

create index if not exists wisecall_call_logs_contact_id
  on wisecall_call_logs (contact_id)
  where contact_id is not null;
