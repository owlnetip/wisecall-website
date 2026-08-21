-- Allow more than one SMS number per agent.
-- Inbound still resolves by unique sms_number → profile.

ALTER TABLE public.wisecall_sms_numbers
  DROP CONSTRAINT IF EXISTS wisecall_sms_numbers_profile_id_key;

CREATE INDEX IF NOT EXISTS wisecall_sms_numbers_profile_id_idx
  ON public.wisecall_sms_numbers (profile_id);
