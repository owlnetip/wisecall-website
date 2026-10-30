-- Hourly (06:20-21:20 UTC) Rightmove listing sync for agents with a
-- property_listing_feeds row. Authenticates with the Vault cron_secret.
select cron.schedule(
  'wisecall-listing-sync',
  '20 6-21 * * *',
  $$
  select net.http_post(
    url := 'https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-listing-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $$
);
