-- Idempotency guard for the email channel. Resend delivers the email.received
-- webhook at-least-once (it retries when the handler is slow), which made the
-- agent reply twice. wisecall-email-inbound claims the Resend email_id here
-- before replying; a primary-key conflict means it's a duplicate delivery → skip.

create table if not exists wisecall_email_processed (
  email_id   text primary key,
  created_at timestamptz not null default now()
);
