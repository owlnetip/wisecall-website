-- Mirror of apps/portal/supabase/migrations/0029_viewing_owner_confirm.sql
-- for environments that apply migrations from /supabase/migrations.

create table if not exists wisecall_properties (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  address         text not null,
  postcode        text,
  listing_ref     text,
  listing_url     text,
  owner_name      text,
  owner_phone     text,
  owner_email     text,
  owner_preferred_channel text not null default 'auto'
    check (owner_preferred_channel in ('auto', 'whatsapp', 'sms', 'email')),
  notes           text,
  is_active       boolean not null default true,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wisecall_properties_profile_idx
  on wisecall_properties (profile_id);
create index if not exists wisecall_properties_owner_phone_idx
  on wisecall_properties (profile_id, owner_phone)
  where owner_phone is not null and owner_phone <> '';

create table if not exists wisecall_viewing_requests (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null,
  property_id        uuid references wisecall_properties(id) on delete set null,
  appointment_id     uuid references wisecall_appointments(id) on delete set null,
  contact_id         uuid references wisecall_contacts(id) on delete set null,
  property_address   text not null,
  listing_ref        text,
  owner_name         text,
  owner_phone        text,
  owner_email        text,
  viewer_name        text,
  viewer_phone       text,
  viewer_email       text,
  proposed_starts_at timestamptz not null,
  proposed_ends_at   timestamptz not null,
  agent_availability_checked boolean not null default false,
  agent_available            boolean,
  agent_availability_note    text,
  status             text not null default 'requested'
    check (status in (
      'requested',
      'pending_owner',
      'confirmed',
      'declined',
      'change_requested',
      'cancelled',
      'expired',
      'completed'
    )),
  owner_channel      text check (owner_channel is null or owner_channel in ('whatsapp', 'sms', 'email')),
  owner_asked_at     timestamptz,
  owner_responded_at timestamptz,
  owner_response_raw text,
  confirmed_at                    timestamptz,
  confirmation_sent_to_viewer_at  timestamptz,
  confirmation_sent_to_agent_at   timestamptz,
  day_before_still_ok_sent_at     timestamptz,
  day_before_still_ok_response    text
    check (day_before_still_ok_response is null
      or day_before_still_ok_response in ('ok', 'change')),
  day_of_reminder_sent_at         timestamptz,
  source             text not null default 'phone'
    check (source in ('phone', 'whatsapp', 'sms', 'email', 'manual', 'web')),
  call_id            text,
  notes              text,
  metadata           jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists wisecall_viewing_requests_profile_status_idx
  on wisecall_viewing_requests (profile_id, status, proposed_starts_at);
create index if not exists wisecall_viewing_requests_owner_phone_idx
  on wisecall_viewing_requests (profile_id, owner_phone, status)
  where owner_phone is not null;
create index if not exists wisecall_viewing_requests_viewer_phone_idx
  on wisecall_viewing_requests (profile_id, viewer_phone, status)
  where viewer_phone is not null;
create index if not exists wisecall_viewing_requests_reminders_idx
  on wisecall_viewing_requests (status, proposed_starts_at)
  where status = 'confirmed';

create table if not exists wisecall_viewing_messages (
  id                  uuid primary key default gen_random_uuid(),
  viewing_request_id  uuid not null references wisecall_viewing_requests(id) on delete cascade,
  profile_id          uuid not null,
  direction           text not null check (direction in ('outbound', 'inbound')),
  channel             text not null check (channel in ('sms', 'whatsapp', 'email')),
  party               text not null check (party in ('owner', 'viewer', 'agent')),
  to_address          text,
  from_address        text,
  body                text not null,
  provider_message_id text,
  purpose             text not null
    check (purpose in (
      'owner_ask',
      'confirm_viewer',
      'confirm_agent',
      'day_before_still_ok',
      'day_of_reminder',
      'decline_viewer',
      'change_ack',
      'reply',
      'other'
    )),
  created_at          timestamptz not null default now()
);

create index if not exists wisecall_viewing_messages_request_idx
  on wisecall_viewing_messages (viewing_request_id, created_at desc);

alter table wisecall_properties enable row level security;
alter table wisecall_viewing_requests enable row level security;
alter table wisecall_viewing_messages enable row level security;

revoke all on public.wisecall_properties from anon, authenticated;
revoke all on public.wisecall_viewing_requests from anon, authenticated;
revoke all on public.wisecall_viewing_messages from anon, authenticated;
