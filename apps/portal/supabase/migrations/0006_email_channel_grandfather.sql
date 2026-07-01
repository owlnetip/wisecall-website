-- Grandfather existing live/test email channel users when the paid add-on gate ships.
-- These accounts were using email inbound before Stripe add-on checkout existed.

-- Excel Telecom / Ring2Teams / luke test business
update public.wisecall_billing
set
  email_channel_enabled = true,
  email_channel_status = 'active',
  email_monthly_allowance = 100,
  updated_at = now()
where user_id = '7ab0c21f-4f77-44da-b90f-6386a46e5e8c'::uuid;

-- Charles Garth (owner id prefix b9633452 - verify one row matches before apply)
update public.wisecall_billing
set
  email_channel_enabled = true,
  email_channel_status = 'active',
  email_monthly_allowance = 100,
  updated_at = now()
where user_id::text like 'b9633452%';

update public.wisecall_profiles
set metadata = jsonb_set(coalesce(metadata, '{}'::jsonb), '{email_channel_enabled}', 'true'::jsonb)
where metadata ->> 'owner_id' = '7ab0c21f-4f77-44da-b90f-6386a46e5e8c'
   or metadata ->> 'owner_id' like 'b9633452%';
