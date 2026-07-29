-- Mirror of apps/portal/supabase/migrations/0031_digital_negotiator.sql
-- for environments that apply migrations from /supabase/migrations.

-- Digital Negotiator: structured enquiries + richer listing fields.
--
-- Complements the owner-confirm viewing loop (0029):
--   • wisecall_enquiries — qualified buyers/tenants/vendors from calls & tools
--   • wisecall_properties — beds/price/status for matching during qualification
--
-- Trainable tone/rules live on wisecall_profiles.metadata.negotiator_rules
-- (no table — same pattern as office_hours).
--
-- Service-role only (no anon/authenticated grants). Matches 0025 RLS tighten.

alter table wisecall_properties
  add column if not exists beds integer,
  add column if not exists baths integer,
  add column if not exists price_text text,
  add column if not exists property_type text,
  add column if not exists listing_status text not null default 'available'
    check (listing_status in (
      'available',
      'under_offer',
      'sstc',
      'let_agreed',
      'withdrawn',
      'unknown'
    ));

create table if not exists wisecall_enquiries (
  id              uuid primary key default gen_random_uuid(),
  profile_id      uuid not null,
  contact_id      uuid references wisecall_contacts(id) on delete set null,
  property_id     uuid references wisecall_properties(id) on delete set null,
  viewing_id      uuid references wisecall_viewing_requests(id) on delete set null,
  call_log_id     uuid,
  call_id         text,

  -- buyer | tenant | vendor | landlord | other
  party_role      text not null default 'buyer'
    check (party_role in ('buyer', 'tenant', 'vendor', 'landlord', 'other')),

  -- new → qualifying → qualified → viewing_requested → confirmed
  -- → handed_to_negotiator → closed_lost | closed_won
  status          text not null default 'new'
    check (status in (
      'new',
      'qualifying',
      'qualified',
      'viewing_requested',
      'confirmed',
      'handed_to_negotiator',
      'closed_lost',
      'closed_won'
    )),

  contact_name    text,
  contact_phone   text,
  contact_email   text,

  -- Qualification snapshot (Greenhouse-style buyer/tenant intake)
  budget_min      integer,
  budget_max      integer,
  budget_text     text,
  areas           text[] not null default '{}',
  beds_min        integer,
  property_types  text[] not null default '{}',
  move_timeline   text,
  financing       text,
  has_property_to_sell boolean,
  chain_position  text,
  listing_interest text,
  listing_ref     text,

  summary         text,
  needs_human     boolean not null default false,
  human_reason    text,

  source          text not null default 'phone'
    check (source in ('phone', 'whatsapp', 'sms', 'email', 'web', 'manual', 'analysis')),
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists wisecall_enquiries_profile_status_idx
  on wisecall_enquiries (profile_id, status, created_at desc);
create index if not exists wisecall_enquiries_profile_created_idx
  on wisecall_enquiries (profile_id, created_at desc);
create index if not exists wisecall_enquiries_phone_idx
  on wisecall_enquiries (profile_id, contact_phone)
  where contact_phone is not null and contact_phone <> '';
create index if not exists wisecall_enquiries_call_log_idx
  on wisecall_enquiries (call_log_id)
  where call_log_id is not null;

alter table wisecall_enquiries enable row level security;
revoke all on public.wisecall_enquiries from anon, authenticated;
