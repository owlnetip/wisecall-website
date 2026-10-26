-- Salesforce → Vonage SMS prototype.
-- A phone number is stored against one Salesforce record only after the caller
-- confirms the mapping. Reply delivery uses the confirmed recipient on that row.
-- Duplicate numbers are not auto-assigned.

create table if not exists public.wisecall_salesforce_sms_bindings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.wisecall_profiles(id) on delete cascade,
  phone_digits text not null,
  salesforce_record_id text not null,
  salesforce_object text not null check (salesforce_object in ('Contact', 'Lead')),
  record_name text,
  reply_recipient_type text not null check (reply_recipient_type in ('owner', 'user')),
  reply_recipient_id text not null,
  reply_recipient_name text,
  reply_recipient_email text,
  confirmed_candidate_ids jsonb not null default '[]'::jsonb,
  confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, phone_digits)
);

create table if not exists public.wisecall_salesforce_sms_messages (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.wisecall_profiles(id) on delete cascade,
  binding_id uuid references public.wisecall_salesforce_sms_bindings(id) on delete set null,
  direction text not null check (direction in ('outbound', 'inbound')),
  phone_digits text not null,
  body text not null,
  status text not null,
  salesforce_record_id text,
  salesforce_task_id text,
  provider text,
  provider_message_id text,
  idempotency_key text,
  detail jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists wisecall_salesforce_sms_messages_idempotency_idx
  on public.wisecall_salesforce_sms_messages (profile_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists wisecall_salesforce_sms_messages_profile_idx
  on public.wisecall_salesforce_sms_messages (profile_id, created_at desc);

alter table public.wisecall_salesforce_sms_bindings enable row level security;
alter table public.wisecall_salesforce_sms_messages enable row level security;

revoke all on public.wisecall_salesforce_sms_bindings from anon, authenticated;
revoke all on public.wisecall_salesforce_sms_messages from anon, authenticated;

grant select, insert, update, delete on public.wisecall_salesforce_sms_bindings to service_role;
grant select, insert, update, delete on public.wisecall_salesforce_sms_messages to service_role;
