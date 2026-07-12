-- Close the anon-key hole on the WiseCall agent tables.
--
-- wisecall_profiles, wisecall_webhook_rules, and wisecall_call_logs had
-- "public_read"/"public_write" policies with USING(true)/WITH CHECK(true),
-- plus full anon+authenticated table grants. Combined with the anon key
-- being shipped in every client bundle, this meant anyone holding the
-- public anon key could read/write every WiseCall agent (including
-- dentally_api_key and webhook secrets) via raw PostgREST calls, no
-- login required.
--
-- These policies existed only because loveableowlnetportal's
-- useWiseCallApi.ts read/wrote these tables directly from the browser
-- with the anon client. That hook now goes through the service-role
-- wisecall-agents-admin edge function instead (see
-- owlnetip/loveableowlnetportal PR #35), and every other consumer across
-- both repos already used the service-role key. Service role bypasses
-- RLS and keeps its own explicit grants, so this migration only removes
-- the anon/authenticated surface.

drop policy if exists wisecall_profiles_public_read on public.wisecall_profiles;
drop policy if exists wisecall_profiles_public_write on public.wisecall_profiles;
drop policy if exists wisecall_webhooks_public_read on public.wisecall_webhook_rules;
drop policy if exists wisecall_webhooks_public_write on public.wisecall_webhook_rules;
drop policy if exists wisecall_logs_public_read on public.wisecall_call_logs;
drop policy if exists wisecall_logs_public_write on public.wisecall_call_logs;

revoke all on public.wisecall_profiles from anon, authenticated;
revoke all on public.wisecall_webhook_rules from anon, authenticated;
revoke all on public.wisecall_call_logs from anon, authenticated;
