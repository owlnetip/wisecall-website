-- Property vertical for outreach CRM (Birmingham estate agents first).
-- Reuses wisecall_outreach_prospects + Resend sequences; no Attio.

alter table wisecall_outreach_prospects
  add column if not exists vertical text not null default 'dental';

alter table wisecall_outreach_prospects
  drop constraint if exists wisecall_outreach_prospects_vertical_check;

alter table wisecall_outreach_prospects
  add constraint wisecall_outreach_prospects_vertical_check
  check (vertical in ('dental', 'property'));

create index if not exists wisecall_outreach_prospects_vertical_segment
  on wisecall_outreach_prospects (vertical, outreach_segment, region, status);

alter table wisecall_outreach_prospects
  drop constraint if exists wisecall_outreach_prospects_outreach_segment_check;

alter table wisecall_outreach_prospects
  add constraint wisecall_outreach_prospects_outreach_segment_check
  check (outreach_segment in (
    'dentally_active',
    'exact_queued',
    'unknown_queued',
    'corporate_hold',
    'property_ready',
    'property_unknown',
    'property_corporate_hold'
  ));

-- Property lettings sequence (day 0 / 3 / 7 / 14). Merge fields:
-- {{practice_name}} / {{company_name}}, {{contact_name}}, {{crm}}, {{area}}, {{region}}, {{postcode}}
insert into wisecall_outreach_email_templates (
  slug,
  name,
  category,
  sequence_step,
  template_family,
  subject_template,
  body_template
)
values
  (
    'property-lettings-initial',
    'Property lettings — initial outreach',
    'property',
    'initial',
    'property',
    '{{practice_name}} — missed maintenance calls = deposit disputes?',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nSaw {{practice_name}} in {{area}}. Most letting agents we speak to lose 2–3 deposit disputes a year because emergency maintenance calls go to voicemail during viewings or lunch.\n\nWiseCall plugs into {{crm}} and:\n• Detects "gas leak / flood / no heating" in real time → alerts your on-call contractor\n• Flags "complaint / ombudsman / deposit" → notifies the branch manager before it escalates\n• Scores "renew / extend / stay" → auto-creates a renewal task for the negotiator\n\nWorth 15 minutes to see if the same applies to {{practice_name}}?\n\nBest,\n[Your name]\nWiseCall'
  ),
  (
    'property-lettings-follow-up-3',
    'Property lettings — day 3 follow-up',
    'property',
    'follow_up_3',
    'property',
    '3 keywords your CRM misses (but tenants say daily)',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nQuick follow-up on {{practice_name}}.\n\nFrom analysing letting-agency calls, three phrases that often predict deposit disputes:\n1. "Nobody called me back"\n2. "Still not fixed"\n3. "Taking this further"\n\nStandard CRMs do not catch these in real time. WiseCall does — and routes them to the right person.\n\nHappy to run a free 30-day pilot on one branch line.\n\nBest,\n[Your name]'
  ),
  (
    'property-lettings-follow-up-7',
    'Property lettings — day 7 follow-up',
    'property',
    'follow_up_7',
    'property',
    'How peers cut missed emergencies ~94%',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nAgencies similar to {{practice_name}} in {{region}} typically see:\n• Far fewer missed emergency maintenance calls\n• Deposit disputes caught before they escalate\n• Renewal opportunities auto-surfaced for negotiators\n\nBranch managers get a daily risk & opportunity digest instead of chasing voicemails.\n\nOpen to a quick call this week?\n\nBest,\n[Your name]'
  ),
  (
    'property-lettings-follow-up-14',
    'Property lettings — day 14 breakup',
    'property',
    'follow_up_14',
    'property',
    'Closing the loop — {{practice_name}}',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nHave not heard back — assuming call intelligence is not a priority for {{practice_name}} right now.\n\nIf that changes, the pilot offer stands: 30 days, one line, full platform.\n\nAll the best,\n[Your name]'
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  sequence_step = excluded.sequence_step,
  template_family = excluded.template_family,
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  updated_at = now();
