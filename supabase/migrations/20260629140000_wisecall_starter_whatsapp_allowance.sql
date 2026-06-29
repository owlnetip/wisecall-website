-- Starter plan WhatsApp allowance increased from 100 to 250 (matches marketing site).
UPDATE public.wisecall_billing
SET whatsapp_monthly_allowance = 250,
    updated_at = now()
WHERE plan = 'starter'
  AND whatsapp_monthly_allowance = 100;
