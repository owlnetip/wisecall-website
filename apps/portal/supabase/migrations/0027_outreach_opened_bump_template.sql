-- Chase template for Dentally prospects who opened the initial email but did not reply.
insert into wisecall_outreach_email_templates (
  slug,
  name,
  category,
  sequence_step,
  template_family,
  subject_template,
  body_template,
  is_system
)
values (
  'dental-dentally-opened-bump',
  'Dentally — opened, no reply bump',
  'dental',
  'custom',
  'dentally',
  'Re: WiseCall + Dentally at {{practice_name}}',
  E'Hi{{#contact_name}} {{contact_name}}{{/contact_name}},\n\nI sent a note earlier about capturing missed patient calls straight into your Dentally diary — wanted to check it didn''t get buried in a busy inbox.\n\nHappy to send a 2-minute summary or jump on a quick call if useful. If the timing isn''t right, just say and I''ll leave you in peace.\n\nBest,\nLuke\nWiseCall\ninfo@owlnet.io',
  true
)
on conflict (slug) do update set
  name = excluded.name,
  subject_template = excluded.subject_template,
  body_template = excluded.body_template,
  template_family = excluded.template_family,
  updated_at = now();
