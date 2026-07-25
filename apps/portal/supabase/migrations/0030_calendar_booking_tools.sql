-- Diary booking tools: the agent now creates real bookings in the customer's
-- connected Cal.com account (wisecall-calendar-booking edge function), so
-- wisecall_appointments finally gets written to on live calls.
--
-- Two things were missing for that:
--   * a link back to the call the booking came from, for the inbox / timeline
--   * a lookup path for "find the booking for the number that's ringing", which
--     is how a caller reschedules or cancels without a reference number.

alter table wisecall_appointments
  add column if not exists call_id  text,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- find_appointment matches on the caller's number, then the provider booking id
-- is used to reschedule / cancel. Both need to be quick and both are scoped to
-- the agent so one customer can never touch another's diary.
create index if not exists wisecall_appointments_profile_phone
  on wisecall_appointments (profile_id, customer_phone, starts_at)
  where customer_phone is not null;

create index if not exists wisecall_appointments_profile_event
  on wisecall_appointments (profile_id, calendar_event_id)
  where calendar_event_id is not null;

create index if not exists wisecall_appointments_call
  on wisecall_appointments (call_id) where call_id is not null;

-- Cal.com issues a new booking uid on every reschedule, so the same underlying
-- appointment row is updated rather than duplicated. Nothing enforces
-- uniqueness on (profile_id, calendar_event_id) because cancelled bookings keep
-- their old id for the audit trail.
