-- Tracks when the 24h-before "final" trial reminder was sent, so the
-- wisecall-trial-final-reminder cron only nudges each trial once.
alter table wisecall_billing
  add column if not exists trial_final_reminder_sent_at timestamptz;

-- Caller's mobile, captured from the Stripe customer by the 3-day trial reminder
-- webhook and reused by the 24h final reminder. (The webhook already wrote here;
-- the column was missing in this environment.)
alter table wisecall_billing
  add column if not exists notification_phone text;
