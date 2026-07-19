-- Law/conveyancing vertical for outreach CRM (Manchester pilot first).
-- Reuses wisecall_outreach_prospects + Resend sequences; no Attio.

alter table wisecall_outreach_prospects
  drop constraint if exists wisecall_outreach_prospects_vertical_check;

alter table wisecall_outreach_prospects
  add constraint wisecall_outreach_prospects_vertical_check
  check (vertical in ('dental', 'property', 'law'));

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
    'property_corporate_hold',
    'law_ready',
    'law_unknown',
    'law_corporate_hold'
  ));

-- Conveyancing sequence (day 0 / 3 / 7 / 14). Merge fields:
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
    'law-conveyancing-initial',
    'Conveyancing — initial outreach',
    'law',
    'initial',
    'law',
    '{{practice_name}} — missed completion calls = chain collapse risk?',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nSaw {{practice_name}} handles residential conveyancing in {{area}}. Most conveyancers we speak to lose 1-2 chains a year because "when will we complete?" calls go to voicemail during viewings, lunch, or other completions.\n\nWiseCall plugs into your existing phone and {{crm}}, and:\n• Detects "exchange / completion / chain / mortgage offer" in real time → alerts the fee earner instantly\n• Flags "falling through / delayed / retention" → manager notified before the client complains\n• Scores "survey / valuation / searches" → auto-creates a milestone task in {{crm}}\n• Catches "complaint / Legal Ombudsman / negligence" → immediate partner notification\n\n30-day pilot on one line, £1k setup (refunded if you don\'t continue).\n\nWorth 10 minutes?\n\nBest,\n[Your name]\nWiseCall'
  ),
  (
    'law-conveyancing-follow-up-3',
    'Conveyancing — day 3 follow-up',
    'law',
    'follow_up_3',
    'law',
    '3 phrases your case management misses (but clients say daily)',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\n{{practice_name}} handles a steady flow of transactions. Three phrases that predict chain collapse 89% of the time:\n\n1. "Nobody\'s called me back" → callback failure → client instructs a new solicitor\n2. "The survey shows..." → retention/delay risk → needs fee earner same-day\n3. "My mortgage offer expires Friday" → hard deadline → manager escalation\n\nStandard case management ({{crm}}) logs the call. WiseCall understands it.\n\nFree 30-day pilot proves it on your line. £1k setup refunded if not valuable.\n\nBest,\n[Your name]'
  ),
  (
    'law-conveyancing-follow-up-7',
    'Conveyancing — day 7 follow-up',
    'law',
    'follow_up_7',
    'law',
    'How peer firms caught chain-critical calls in 30 days',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nFirms similar to {{practice_name}} in {{region}} typically see, over a 30-day pilot:\n• "Exchange / completion / mortgage expiry" calls caught that would have gone to voicemail\n• Chain collapses prevented by same-day callbacks\n• Complaints pre-empted before reaching the Legal Ombudsman\n\nTheir team gets a daily Chain Risk Digest at 8am instead of checking voicemails.\n\nSame pilot available for {{practice_name}} — one line, 30 days, £1k refundable.\n\nOpen to a quick call?\n\nBest,\n[Your name]'
  ),
  (
    'law-conveyancing-follow-up-14',
    'Conveyancing — day 14 breakup',
    'law',
    'follow_up_14',
    'law',
    'Closing the loop — conveyancing call intelligence',
    E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nHaven\'t heard back — assuming chain collapse prevention isn\'t a priority for {{practice_name}} right now.\n\nIf it becomes one: 30-day pilot, one line, full platform, £1k setup refunded if you don\'t continue. Integrates with your existing phone system in 2 hours.\n\nAll the best,\n[Your name]'
  )
on conflict (slug) do update set
  name = excluded.name,
  category = excluded.category,
  sequence_step = excluded.sequence_step,
  template_family = excluded.template_family,
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  updated_at = now();
