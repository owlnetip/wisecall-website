-- Trial call-cap notification (email + SMS via pg_net → edge function)
-- Project: zgzzpwaqqftmugzpccpm
--
-- When a trialing customer hits their AI-call cap, the existing trigger disables
-- agents and now queues a one-off HTTP call to `wisecall-trial-cap-reached`.
--
-- After applying this migration:
--   1. Enable the pg_net extension in Supabase Dashboard if not already on.
--   2. Deploy the edge function from supabase/functions/wisecall-trial-cap-reached.
--   3. Store the trigger secret (same value as WISECALL_TRIAL_REMINDER_SECRET on Vercel):
--        insert into private.wisecall_runtime_config (key, value)
--        values ('trial_reminder_secret', '<secret>')
--        on conflict (key) do update set value = excluded.value;
--   4. Optionally override the function URL (defaults to production project):
--        insert into private.wisecall_runtime_config (key, value)
--        values ('trial_cap_notify_url', 'https://<ref>.supabase.co/functions/v1/wisecall-trial-cap-reached')
--        on conflict (key) do update set value = excluded.value;

create extension if not exists pg_net with schema extensions;

create schema if not exists private;

create table if not exists private.wisecall_runtime_config (
  key   text primary key,
  value text not null
);

revoke all on schema private from public;
revoke all on table private.wisecall_runtime_config from public;

alter table public.wisecall_billing
  add column if not exists notification_phone text,
  add column if not exists trial_cap_notified_at timestamptz;

-- Resolve the shared trigger secret for pg_net calls (fail-soft when unset).
create or replace function private.wisecall_notify_secret()
returns text
language plpgsql
stable
security definer
set search_path = private, public, vault
as $$
declare
  v text;
begin
  select value
    into v
  from private.wisecall_runtime_config
  where key = 'trial_reminder_secret';

  if v is not null and v <> '' then
    return v;
  end if;

  begin
    select decrypted_secret
      into v
    from vault.decrypted_secrets
    where name = 'wisecall_trial_reminder_secret'
    limit 1;

    if v is not null and v <> '' then
      return v;
    end if;
  exception
    when undefined_table or invalid_schema_name then
      null;
  end;

  return nullif(current_setting('wisecall.trial_reminder_secret', true), '');
end;
$$;

create or replace function private.wisecall_trial_cap_notify_url()
returns text
language sql
stable
security definer
set search_path = private, public
as $$
  select coalesce(
    (select value from private.wisecall_runtime_config where key = 'trial_cap_notify_url'),
    'https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-trial-cap-reached'
  );
$$;

-- Queue the cap-reached notification. Never raises — call logging must succeed.
create or replace function public.wisecall_queue_trial_cap_notification(p_owner uuid)
returns void
language plpgsql
security definer
set search_path = public, private, extensions, net
as $$
declare
  v_secret text;
  v_url    text;
begin
  v_secret := private.wisecall_notify_secret();
  if v_secret is null or v_secret = '' then
    raise warning 'wisecall_queue_trial_cap_notification: trial_reminder_secret not configured';
    return;
  end if;

  v_url := private.wisecall_trial_cap_notify_url();

  perform net.http_post(
    url := v_url,
    body := jsonb_build_object('owner_id', p_owner::text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-trigger-secret', v_secret
    ),
    timeout_milliseconds := 8000
  );
exception
  when others then
    raise warning 'wisecall_queue_trial_cap_notification failed for %: %', p_owner, SQLERRM;
end;
$$;

-- Replaces the trial-cap trigger to also notify once when the cap is first hit.
create or replace function public.wisecall_enforce_trial_cap()
returns trigger
language plpgsql
security definer
set search_path = public, private, extensions, net
as $$
declare
  v_owner   uuid;
  v_status  text;
  v_cap     integer;
  v_count   integer;
  v_claimed uuid;
begin
  v_owner := public.wisecall_profile_owner(new.profile_id);
  if v_owner is null then
    return new;
  end if;

  select status, trial_call_cap
    into v_status, v_cap
  from public.wisecall_billing
  where user_id = v_owner;

  if v_status is distinct from 'trialing' then
    return new;
  end if;

  v_cap := coalesce(v_cap, 20);
  v_count := public.wisecall_owner_call_count(v_owner);

  if v_count >= v_cap then
    update public.wisecall_profiles
      set is_active = false,
          metadata  = jsonb_set(coalesce(metadata, '{}'::jsonb), '{trial_blocked}', 'true'::jsonb)
    where metadata ->> 'owner_id' = v_owner::text;

    update public.wisecall_billing
      set trial_cap_notified_at = now()
    where user_id = v_owner
      and trial_cap_notified_at is null
    returning user_id into v_claimed;

    if v_claimed is not null then
      perform public.wisecall_queue_trial_cap_notification(v_claimed);
    end if;
  end if;

  return new;
end;
$$;
