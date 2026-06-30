-- Reseller / partner program (Phase 1: referral + recurring commission).
--
-- Partners refer customers via a unique link (?ref=CODE). WiseCall remains the
-- merchant of record and bills the customer directly; the partner earns a
-- recurring revenue share (default 30% of net subscription revenue) for the
-- life of the customer. Read-only model - partners see their book of business
-- but do not manage clients' agents.

-- 1. Partners. One row per partner; user_id is the auth user who logs in to the
--    partner console. referral_code is what appears in their signup link.
CREATE TABLE IF NOT EXISTS public.wisecall_partners (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid        NOT NULL,                 -- auth.users id of the partner login
  name            text        NOT NULL,                 -- partner / company display name
  referral_code   text        NOT NULL,                 -- appears in ?ref=CODE (lowercased)
  commission_rate numeric(5,4) NOT NULL DEFAULT 0.30,   -- 0.30 = 30%
  contact_email   text,
  status          text        NOT NULL DEFAULT 'active', -- active | paused
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (referral_code),
  UNIQUE (user_id)  -- one partner profile per login
);

CREATE INDEX IF NOT EXISTS wisecall_partners_referral_code_idx
  ON public.wisecall_partners (referral_code);

-- 2. Attribution: which partner referred a customer. Stamped on the billing row
--    (one per customer) by the Stripe webhook from the user's signup metadata.
ALTER TABLE public.wisecall_billing
  ADD COLUMN IF NOT EXISTS partner_id uuid REFERENCES public.wisecall_partners(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS wisecall_billing_partner_id_idx
  ON public.wisecall_billing (partner_id);

-- 3. Commission ledger. One row per paid Stripe invoice for a referred customer.
--    amount_base_pence = net (ex-VAT) subscription revenue the commission is on.
CREATE TABLE IF NOT EXISTS public.wisecall_partner_commissions (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id        uuid        NOT NULL REFERENCES public.wisecall_partners(id) ON DELETE CASCADE,
  customer_user_id  uuid        NOT NULL,                 -- referred customer (auth.users id)
  stripe_invoice_id text        NOT NULL,                 -- dedupe key
  amount_base_pence integer     NOT NULL DEFAULT 0,       -- net revenue commission is calculated on
  commission_pence  integer     NOT NULL DEFAULT 0,       -- amount_base_pence * rate
  commission_rate   numeric(5,4) NOT NULL DEFAULT 0.30,
  currency          text        NOT NULL DEFAULT 'gbp',
  status            text        NOT NULL DEFAULT 'pending', -- pending | paid
  created_at        timestamptz NOT NULL DEFAULT now(),
  paid_at           timestamptz,
  UNIQUE (stripe_invoice_id)
);

CREATE INDEX IF NOT EXISTS wisecall_partner_commissions_partner_id_idx
  ON public.wisecall_partner_commissions (partner_id);

-- 4. RLS. Partners can read their own partner row and their own commissions.
--    All writes + cross-customer book-of-business reads happen via the service
--    role in server actions (gated by isPartner), mirroring the admin pattern.
ALTER TABLE public.wisecall_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wisecall_partner_commissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "partners_self_select"
  ON public.wisecall_partners FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "partner_commissions_owner_select"
  ON public.wisecall_partner_commissions FOR SELECT
  USING (
    partner_id IN (
      SELECT id FROM public.wisecall_partners WHERE user_id = auth.uid()
    )
  );
