-- WiseCall appointment booking - calendar connectors + bookable services + bookings.
-- Native Google Calendar / Microsoft 365 integration. All service-role only
-- (no RLS-exposed token reads). Tokens are sensitive; access via the service key
-- only and consider pgsodium encryption as a hardening follow-up.

-- One connected calendar per agent per provider.
create table if not exists wisecall_calendar_connections (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  provider        text not null check (provider in ('google', 'microsoft')),
  account_email   text,
  calendar_id     text,                          -- target calendar (provider id; null = primary)
  access_token    text,
  refresh_token   text,
  token_expires_at timestamptz,
  scopes          text,
  status          text not null default 'connected', -- connected | revoked | error
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (profile_id, provider)
);
create index if not exists wisecall_calendar_connections_profile
  on wisecall_calendar_connections (profile_id);

-- Bookable services the agent can offer (per-service slot length + buffers).
create table if not exists wisecall_appointment_types (
  id                 uuid primary key default gen_random_uuid(),
  profile_id         uuid not null,
  name               text not null,
  description        text,
  duration_mins      int not null default 30,
  buffer_before_mins int not null default 0,
  buffer_after_mins  int not null default 0,
  is_active          boolean not null default true,
  sort_order         int not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists wisecall_appointment_types_profile
  on wisecall_appointment_types (profile_id);

-- Appointments the agent books (linked to the contact + the calendar event).
create table if not exists wisecall_appointments (
  id                  uuid primary key default gen_random_uuid(),
  profile_id          uuid not null,
  contact_id          uuid references wisecall_contacts(id) on delete set null,
  appointment_type_id uuid references wisecall_appointment_types(id) on delete set null,
  provider            text,
  calendar_event_id   text,                      -- event id in Google/MS (for reschedule/cancel)
  starts_at           timestamptz not null,
  ends_at             timestamptz not null,
  customer_name       text,
  customer_phone      text,
  customer_email      text,
  service_name        text,                      -- snapshot of the type name at booking time
  notes               text,
  status              text not null default 'booked', -- booked | rescheduled | cancelled | completed | no_show
  confirmation_sent   boolean not null default false,
  source              text not null default 'phone',  -- phone | email | manual
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists wisecall_appointments_profile_start
  on wisecall_appointments (profile_id, starts_at desc);
create index if not exists wisecall_appointments_contact
  on wisecall_appointments (contact_id) where contact_id is not null;

-- Booking rules live on wisecall_profiles.metadata.booking_rules (jsonb):
--   { min_notice_mins, max_days_ahead, slot_granularity_mins, default_appointment_type_id }
-- (kept in metadata so no extra table + reuses the existing office_hours + timezone.)
