-- Salesforce-driven SMS (BetterMove architecture, 25 Sep 2026): a thread can be
-- linked to a Person Account, and reply ownership is decided in Salesforce
-- (WiseCallSmsReplyResource), so WiseCall no longer needs a named recipient.
alter table public.wisecall_salesforce_sms_bindings
  drop constraint if exists wisecall_salesforce_sms_bindings_salesforce_object_check;
alter table public.wisecall_salesforce_sms_bindings
  add constraint wisecall_salesforce_sms_bindings_salesforce_object_check
  check (salesforce_object in ('Contact', 'Lead', 'Account'));
alter table public.wisecall_salesforce_sms_bindings
  drop constraint if exists wisecall_salesforce_sms_bindings_reply_recipient_type_check;
alter table public.wisecall_salesforce_sms_bindings
  add constraint wisecall_salesforce_sms_bindings_reply_recipient_type_check
  check (reply_recipient_type in ('owner', 'user', 'salesforce'));
alter table public.wisecall_salesforce_sms_bindings
  alter column reply_recipient_id drop not null;
