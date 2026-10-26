-- wisecall_record_sms_message compared wisecall_billing.user_id (uuid) with a
-- text variable, so every call failed ("operator does not exist: uuid = text")
-- and no SMS was ever counted. Cast the owner id.
CREATE OR REPLACE FUNCTION public.wisecall_record_sms_message(p_profile_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_owner_id   uuid;
  v_allowance  integer;
  v_used       integer;
BEGIN
  SELECT NULLIF(metadata->>'owner_id', '')::uuid INTO v_owner_id
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
$function$;
