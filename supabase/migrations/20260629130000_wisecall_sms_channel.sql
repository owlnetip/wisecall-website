-- SMS channel: billing usage columns, number pool table, usage RPC.

-- 1. Billing usage tracking columns
ALTER TABLE public.wisecall_billing
  ADD COLUMN IF NOT EXISTS sms_monthly_allowance integer,
  ADD COLUMN IF NOT EXISTS sms_used_period       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sms_overage_period    integer NOT NULL DEFAULT 0;

-- 2. Pool of Vonage SMS numbers, one per agent.
CREATE TABLE IF NOT EXISTS public.wisecall_sms_numbers (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id       uuid        NOT NULL REFERENCES public.wisecall_profiles(id) ON DELETE CASCADE,
  sms_number       text        NOT NULL,   -- E.164 (e.g. +447...)
  vonage_number_id text,                   -- raw msisdn from Vonage (digits only)
  status           text        NOT NULL DEFAULT 'active', -- active | released
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sms_number),
  UNIQUE (profile_id)  -- one SMS number per agent
);

ALTER TABLE public.wisecall_sms_numbers ENABLE ROW LEVEL SECURITY;

-- Agents owned by the signed-in user can read their SMS numbers.
CREATE POLICY "sms_numbers_owner_select"
  ON public.wisecall_sms_numbers FOR SELECT
  USING (
    profile_id IN (
      SELECT id FROM public.wisecall_profiles
      WHERE metadata->>'owner_id' = auth.uid()::text
    )
  );

-- 3. Usage RPC called by wisecall-sms-inbound after each reply.
CREATE OR REPLACE FUNCTION public.wisecall_record_sms_message(p_profile_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_owner_id   text;
  v_allowance  integer;
  v_used       integer;
BEGIN
  SELECT metadata->>'owner_id' INTO v_owner_id
  FROM public.wisecall_profiles WHERE id = p_profile_id;
  IF v_owner_id IS NULL THEN RETURN; END IF;

  SELECT
    COALESCE(sms_monthly_allowance, 100),
    COALESCE(sms_used_period, 0)
  INTO v_allowance, v_used
  FROM public.wisecall_billing WHERE user_id = v_owner_id;

  UPDATE public.wisecall_billing
  SET
    sms_used_period    = v_used + 1,
    sms_overage_period = GREATEST(0, (v_used + 1) - v_allowance),
    updated_at         = now()
  WHERE user_id = v_owner_id;
END;
$$;
