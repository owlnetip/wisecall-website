-- Outreach segment: active Dentally vs queued for Exact / unknown PMS.

alter table wisecall_outreach_prospects
  add column if not exists outreach_segment text not null default 'unknown_queued';

alter table wisecall_outreach_prospects
  drop constraint if exists wisecall_outreach_prospects_outreach_segment_check;

alter table wisecall_outreach_prospects
  add constraint wisecall_outreach_prospects_outreach_segment_check
  check (outreach_segment in ('dentally_active', 'exact_queued', 'unknown_queued', 'corporate_hold'));

create index if not exists wisecall_outreach_prospects_segment
  on wisecall_outreach_prospects (outreach_segment, region, status);

-- Exact/SOE email templates (queued until integration ships)
insert into wisecall_outreach_email_templates (slug, name, category, sequence_step, subject_template, body_template)
values
  (
    'dental-exact-initial',
    'Exact/SOE — initial outreach (draft)',
    'dental',
    'initial',
    'WiseCall for {{practice_name}} — never miss a patient call',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nWe help dental practices on Exact (Software of Excellence) capture patient calls with AI summaries your team can action — appointments, emergencies and new patient enquiries.\n\nWould a quick overview be useful?\n\nBest,\n[Your name]\nWiseCall'
  ),
  (
    'dental-exact-follow-up-3',
    'Exact/SOE — day 3 follow-up (draft)',
    'dental',
    'follow_up_3',
    'Re: WiseCall at {{practice_name}}',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nJust following up — happy to show how practices on Exact use WiseCall to reduce missed calls without changing your diary workflow.\n\nBest,\n[Your name]'
  )
on conflict (slug) do nothing;
