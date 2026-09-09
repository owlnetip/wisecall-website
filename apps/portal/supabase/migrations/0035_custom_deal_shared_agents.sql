-- Custom / sales-led deals (e.g. Home Cloud): extra included agents on one
-- subscription, shared monthly allowances, and waived per-minute overage.

alter table public.wisecall_billing
  add column if not exists included_agents integer not null default 1,
  add column if not exists overage_waived boolean not null default false;

alter table public.wisecall_billing
  add constraint wisecall_billing_included_agents_check
  check (included_agents >= 1);

comment on column public.wisecall_billing.included_agents is
  'How many numbered agents share this subscription. Catalogue plans are 1; Home Cloud is 2.';

comment on column public.wisecall_billing.overage_waived is
  'When true, invoice.created must not add per-call overage line items.';
