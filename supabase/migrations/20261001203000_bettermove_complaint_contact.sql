-- OWL-115. Bettermove Receptionist only.
--
-- Appends the complaints rule to the instructions the live assistant already
-- uses. It does not replace system_prompt or chat_instructions, and it does
-- not touch business_context, knowledge, listings, routing, or any other agent.
--
-- system_prompt is shared by phone, website chat, email, SMS and WhatsApp.
-- metadata.chat_instructions is the website-chat rule that currently says not
-- to continue when contact details are refused; the complaints exception has
-- to be in that text as well, or chat keeps following the old rule.
--
-- Idempotent: a second run does nothing once customercare@bettermove.co.uk
-- is already present. Not applied by this change itself.

do $migration$
declare
  complaint_rule text := btrim($rule$
Complaints:
If someone wants to make a complaint, first try to learn who they are so the team can call them. Ask for their name and a phone number. Do not offer an email address for the complaint while you are still asking for those details.
Only if they refuse to give their name or their phone number, tell them to put the complaint in writing to customercare@bettermove.co.uk.
Never give hello@bettermove.co.uk as the complaints address. hello@bettermove.co.uk is for general enquiries only, not complaints.
This exception is only for a complaint, and only after they have refused their name or phone number. Do not change how you handle selling, buying, listings, viewings, offers, fees, or any enquiry that is not a complaint.
$rule$);
  target_id uuid := 'b3b2374c-ddc6-4e66-87a8-c60703ac89f9';
  target_slug text := 'bettermove-assistant-bettermove-4a19c75d';
begin
  update public.wisecall_profiles
  set system_prompt = system_prompt || E'\n\n' || complaint_rule
  where id = target_id
    and slug = target_slug
    and system_prompt is not null
    and position('customercare@bettermove.co.uk' in system_prompt) = 0;

  update public.wisecall_profiles
  set metadata = jsonb_set(
    metadata,
    '{chat_instructions}',
    to_jsonb(metadata->>'chat_instructions' || E'\n\n' || complaint_rule)
  )
  where id = target_id
    and slug = target_slug
    and coalesce(metadata->>'chat_instructions', '') <> ''
    and position('customercare@bettermove.co.uk' in metadata->>'chat_instructions') = 0;
end
$migration$;
