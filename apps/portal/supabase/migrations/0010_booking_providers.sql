-- Adapt the booking schema for scheduling-tool integrations (Cal.com + Calendly),
-- the "match Fonio" approach. The customer connects their own Cal.com / Calendly
-- account (API key or personal access token), and the agent books into it - those
-- tools handle the underlying Google/Outlook calendar, slot logic and confirmations.

-- Widen the provider set (keep google/microsoft for a future native-calendar phase).
alter table wisecall_calendar_connections
  drop constraint if exists wisecall_calendar_connections_provider_check;
alter table wisecall_calendar_connections
  add constraint wisecall_calendar_connections_provider_check
  check (provider in ('cal_com', 'calendly', 'google', 'microsoft'));

-- access_token now also holds a Cal.com API key / Calendly PAT (not just OAuth).
-- config: provider-specific settings (e.g. Cal.com username, Calendly user URI).
-- event_types: the bookable event types the agent may offer, fetched from the
--   connected account and chosen by the customer - [{id, slug, title, duration_mins}].
alter table wisecall_calendar_connections
  add column if not exists config       jsonb not null default '{}'::jsonb,
  add column if not exists event_types  jsonb not null default '[]'::jsonb;
