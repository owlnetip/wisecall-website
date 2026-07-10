-- Outreach CRM: Mailchimp/Light-style engagement tracking for Dentally sequences.
-- Adds delivered/open/click/bounce timestamps, template families, and a prospect
-- engagement rollup so the admin CRM can show first email sent + opened.

alter table wisecall_outreach_email_templates
  add column if not exists template_family text not null default 'general';

update wisecall_outreach_email_templates
set template_family = 'dentally'
where slug like 'dental-dentally-%';

update wisecall_outreach_email_templates
set template_family = 'exact'
where slug like 'dental-exact-%';

alter table wisecall_outreach_emails
  add column if not exists delivered_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists clicked_at timestamptz,
  add column if not exists click_count integer not null default 0,
  add column if not exists bounced_at timestamptz,
  add column if not exists complained_at timestamptz,
  add column if not exists last_event_at timestamptz;

create index if not exists wisecall_outreach_emails_resend_id
  on wisecall_outreach_emails (resend_id)
  where resend_id is not null;

create index if not exists wisecall_outreach_emails_opened
  on wisecall_outreach_emails (opened_at)
  where opened_at is not null;

alter table wisecall_outreach_prospects
  add column if not exists first_email_sent_at timestamptz,
  add column if not exists first_email_opened_at timestamptz,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count integer not null default 0,
  add column if not exists last_replied_at timestamptz;

create index if not exists wisecall_outreach_prospects_first_sent
  on wisecall_outreach_prospects (first_email_sent_at)
  where first_email_sent_at is not null;

create index if not exists wisecall_outreach_prospects_opened
  on wisecall_outreach_prospects (first_email_opened_at)
  where first_email_opened_at is not null;

create index if not exists wisecall_outreach_prospects_needs_attention
  on wisecall_outreach_prospects (status, outreach_segment, last_replied_at, first_email_opened_at);

-- Idempotent Resend webhook event log (svix-id)
create table if not exists wisecall_outreach_email_events (
  id              uuid primary key default gen_random_uuid(),
  svix_id         text not null unique,
  event_type      text not null,
  resend_email_id text,
  email_row_id    uuid references wisecall_outreach_emails(id) on delete set null,
  prospect_id     uuid references wisecall_outreach_prospects(id) on delete set null,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists wisecall_outreach_email_events_email
  on wisecall_outreach_email_events (email_row_id, created_at desc);

create index if not exists wisecall_outreach_email_events_type
  on wisecall_outreach_email_events (event_type, created_at desc);

-- Backfill first_email_sent_at from existing sent initial emails
update wisecall_outreach_prospects p
set first_email_sent_at = s.first_sent
from (
  select prospect_id, min(sent_at) as first_sent
  from wisecall_outreach_emails
  where status = 'sent' and sent_at is not null and sequence_step = 'initial'
  group by prospect_id
) s
where p.id = s.prospect_id
  and p.first_email_sent_at is null;
