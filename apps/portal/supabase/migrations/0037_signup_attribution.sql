-- First-touch trial source attribution on the customer billing row.
-- Project: zgzzpwaqqftmugzpccpm. Additive only. Do not apply from the app deploy.
--
-- wisecall_billing is one row per auth user (the trial account). signup_at is
-- set once, when that row is first created, and is the timestamp to group
-- trial starts by ISO week. signup_attribution is the first landing only
-- (src, lp, utm_source, utm_medium, utm_campaign). No email, phone, or click id.
--
-- Weekly trial starts by channel (Europe/London ISO week):
--   select
--     to_char(signup_at at time zone 'Europe/London', 'IYYY-"W"IW') as iso_week,
--     coalesce(signup_attribution->>'src', 'unattributed') as src,
--     count(*)::int as trial_starts
--   from public.wisecall_billing
--   where signup_at is not null
--   group by 1, 2
--   order by 1 desc, 3 desc;

alter table public.wisecall_billing
  add column if not exists signup_at timestamptz;

alter table public.wisecall_billing
  add column if not exists signup_attribution jsonb;

comment on column public.wisecall_billing.signup_at is
  'Set once when this trial account row is created. Group trial starts by ISO week on this column. Never overwrite.';

comment on column public.wisecall_billing.signup_attribution is
  'First-touch marketing attribution: src, lp, utm_source, utm_medium, utm_campaign. No PII. Never overwrite.';

create index if not exists wisecall_billing_signup_at_idx
  on public.wisecall_billing (signup_at)
  where signup_at is not null;
