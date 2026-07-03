-- Admin dental outreach CRM: prospects, email templates, sent/scheduled emails.

create table if not exists wisecall_outreach_prospects (
  id              uuid primary key default gen_random_uuid(),
  practice_name   text not null,
  contact_name    text,
  email           text,
  phone           text,
  postcode        text,
  region          text not null,
  area            text,
  pms             text,
  tier            text,
  website         text,
  notes           text,
  status          text not null default 'new',
  sequence_status text not null default 'none',
  merge_fields    jsonb not null default '{}'::jsonb,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  imported_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wisecall_outreach_prospects_status_check
    check (status in ('new', 'contacted', 'replied', 'interested', 'not_interested', 'paused')),
  constraint wisecall_outreach_prospects_sequence_status_check
    check (sequence_status in ('none', 'active', 'completed', 'stopped')),
  constraint wisecall_outreach_prospects_unique unique (practice_name, postcode, region)
);

create index if not exists wisecall_outreach_prospects_practice_lookup
  on wisecall_outreach_prospects (lower(practice_name), upper(replace(postcode, ' ', '')), region);

create index if not exists wisecall_outreach_prospects_region_status
  on wisecall_outreach_prospects (region, status, updated_at desc);

create index if not exists wisecall_outreach_prospects_next_follow_up
  on wisecall_outreach_prospects (next_follow_up_at)
  where sequence_status = 'active' and next_follow_up_at is not null;

create table if not exists wisecall_outreach_email_templates (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  name            text not null,
  category        text not null default 'dental',
  sequence_step   text not null default 'custom',
  subject_template text not null,
  body_template   text not null,
  is_system       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wisecall_outreach_email_templates_step_check
    check (sequence_step in ('initial', 'follow_up_3', 'follow_up_7', 'follow_up_14', 'custom'))
);

create table if not exists wisecall_outreach_emails (
  id              uuid primary key default gen_random_uuid(),
  prospect_id     uuid not null references wisecall_outreach_prospects(id) on delete cascade,
  template_id     uuid references wisecall_outreach_email_templates(id) on delete set null,
  sequence_step   text not null default 'custom',
  subject         text not null,
  body            text not null,
  to_email        text not null,
  status          text not null default 'draft',
  scheduled_for   timestamptz,
  sent_at         timestamptz,
  resend_id       text,
  error_message   text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wisecall_outreach_emails_status_check
    check (status in ('draft', 'scheduled', 'sent', 'cancelled', 'failed')),
  constraint wisecall_outreach_emails_step_check
    check (sequence_step in ('initial', 'follow_up_3', 'follow_up_7', 'follow_up_14', 'custom'))
);

create index if not exists wisecall_outreach_emails_prospect
  on wisecall_outreach_emails (prospect_id, created_at desc);

create index if not exists wisecall_outreach_emails_due
  on wisecall_outreach_emails (scheduled_for)
  where status = 'scheduled';

-- Seed dental email templates (merge fields: {{practice_name}}, {{contact_name}}, {{postcode}}, {{pms}}, {{area}}, {{region}}, {{website}}, {{phone}})
insert into wisecall_outreach_email_templates (slug, name, category, sequence_step, subject_template, body_template)
values
  (
    'dental-dentally-initial',
    'Dentally — initial outreach',
    'dental',
    'initial',
    'WiseCall for {{practice_name}} — live Dentally booking over the phone',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nI noticed {{practice_name}} in {{postcode}} uses Dentally for online booking — we help practices like yours answer patient calls 24/7 and book straight into the same Dentally diary your portal uses, but over the phone.\n\nWould a two-minute overview be useful this week?\n\nBest,\n[Your name]\nWiseCall'
  ),
  (
    'dental-dentally-follow-up-3',
    'Dentally — day 3 follow-up',
    'dental',
    'follow_up_3',
    'Re: WiseCall + Dentally at {{practice_name}}',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nJust bumping my note from earlier in the week — happy to share how other Dentally practices use WiseCall to capture new patient and emergency calls without extra reception cover.\n\nWorth a quick call?\n\nBest,\n[Your name]'
  ),
  (
    'dental-dentally-follow-up-7',
    'Dentally — day 7 follow-up',
    'dental',
    'follow_up_7',
    'Still missing calls at {{practice_name}}?',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nOne more thought: practices on Dentally often lose bookings when the phone rings out of hours or during busy clinic time. WiseCall handles those calls and books into Dentally automatically.\n\nIf timing isn''t right, no worries — just let me know.\n\nBest,\n[Your name]'
  ),
  (
    'dental-dentally-follow-up-14',
    'Dentally — day 14 final check-in',
    'dental',
    'follow_up_14',
    'Closing the loop — {{practice_name}}',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nI''ll leave this with you for now. If capturing more Dentally bookings from phone calls becomes a priority, I''d be glad to pick it up.\n\nBest,\n[Your name]'
  )
on conflict (slug) do nothing;
