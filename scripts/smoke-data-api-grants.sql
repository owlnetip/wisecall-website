-- Local smoke test for supabase/migrations/20261027120000_data_api_grants.sql.
-- Simulates a project whose existing public objects still have the old Data API
-- grants, plus objects created with no automatic grants (the post-30-Oct case).
-- Run as a superuser against an empty database:
--   psql -d wisecall_grants_smoke -v ON_ERROR_STOP=1 -f scripts/smoke-data-api-grants.sql

\set ON_ERROR_STOP on

do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin bypassrls;
  end if;
end
$roles$;

alter role service_role bypassrls;
grant usage on schema public to anon, authenticated, service_role;

-- Old default privileges: anon can write. The control table must keep that.
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null
);
grant select, insert, update, delete on table public.customers to anon, authenticated, service_role;

create view public.knowledge_base_sources_summary as
  select id, name from public.customers;

create materialized view public.smoke_matview as
  select id from public.customers;

-- OWL-121 tables. ofcom_cupid_codes is not created by any migration; prod has it.
create table public.wisecall_outreach_email_events (id uuid primary key, payload jsonb);
create table public.wisecall_follow_ups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null,
  title text not null
);
create table public.wisecall_agent_memory (id uuid primary key, topic text);
create table public.wisecall_demo_callback_rate_limits (rate_key text primary key);
create table public.ofcom_cupid_codes (id integer primary key, code text);

grant select, insert, update, delete on table
  public.wisecall_outreach_email_events,
  public.wisecall_follow_ups,
  public.wisecall_agent_memory,
  public.wisecall_demo_callback_rate_limits,
  public.ofcom_cupid_codes
to anon, authenticated, service_role;

alter table public.wisecall_follow_ups enable row level security;

-- Post-30-Oct object: no anon/authenticated/service_role grants at all.
create table public.wisecall_billing (user_id uuid primary key);
revoke all on table public.wisecall_billing from PUBLIC;

create table public.sms_messages (
  id bigserial primary key,
  recipient text not null
);
revoke all on table public.sms_messages from PUBLIC;
revoke all on sequence public.sms_messages_id_seq from PUBLIC;

create function public.smoke_ok()
returns boolean
language sql
stable
as $$ select true $$;
revoke all on function public.smoke_ok() from PUBLIC;

create function public.smoke_legacy()
returns boolean
language sql
stable
as $$ select true $$;
revoke all on function public.smoke_legacy() from PUBLIC;
grant execute on function public.smoke_legacy() to anon;

create procedure public.smoke_proc()
language plpgsql
as $$ begin null; end $$;
revoke all on procedure public.smoke_proc() from PUBLIC;

\i supabase/migrations/20261027120000_data_api_grants.sql

do $assert$
declare
  sensitive text[] := array[
    'wisecall_outreach_email_events',
    'wisecall_follow_ups',
    'wisecall_agent_memory',
    'wisecall_demo_callback_rate_limits',
    'ofcom_cupid_codes'
  ];
  rel text;
  privilege text;
begin
  foreach rel in array sensitive loop
    foreach privilege in array ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] loop
      if has_table_privilege('anon', format('public.%I', rel), privilege) then
        raise exception 'anon still has % on %', privilege, rel;
      end if;
      if has_table_privilege('authenticated', format('public.%I', rel), privilege) then
        raise exception 'authenticated still has % on %', privilege, rel;
      end if;
    end loop;
    if not has_table_privilege('anon', format('public.%I', rel), 'SELECT') then
      raise exception 'anon select was revoked on %', rel;
    end if;
    foreach privilege in array ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not has_table_privilege('service_role', format('public.%I', rel), privilege) then
        raise exception 'service_role missing % on %', privilege, rel;
      end if;
    end loop;
  end loop;

  if not has_table_privilege('anon', 'public.customers', 'INSERT') then
    raise exception 'anon insert was revoked on the control table customers';
  end if;

  foreach privilege in array ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
    if not has_table_privilege('service_role', 'public.wisecall_billing', privilege) then
      raise exception 'service_role missing % on a table created without default grants', privilege;
    end if;
    if has_table_privilege('anon', 'public.wisecall_billing', privilege) then
      raise exception 'anon was granted % on wisecall_billing', privilege;
    end if;
    if has_table_privilege('authenticated', 'public.wisecall_billing', privilege) then
      raise exception 'authenticated was granted % on wisecall_billing', privilege;
    end if;
  end loop;

  if not has_table_privilege('service_role', 'public.knowledge_base_sources_summary', 'SELECT') then
    raise exception 'service_role missing select on view';
  end if;
  if not has_table_privilege('service_role', 'public.smoke_matview', 'SELECT') then
    raise exception 'service_role missing select on materialized view';
  end if;
  if not has_sequence_privilege('service_role', 'public.sms_messages_id_seq', 'USAGE') then
    raise exception 'service_role missing sequence usage';
  end if;
  if not has_function_privilege('service_role', 'public.smoke_ok()', 'EXECUTE') then
    raise exception 'service_role missing execute on smoke_ok()';
  end if;
  if has_function_privilege('anon', 'public.smoke_ok()', 'EXECUTE') then
    raise exception 'anon was granted execute on smoke_ok()';
  end if;
  if not has_function_privilege('anon', 'public.smoke_legacy()', 'EXECUTE') then
    raise exception 'existing anon execute was revoked';
  end if;
  if not has_function_privilege('service_role', 'public.smoke_proc()', 'EXECUTE') then
    raise exception 'service_role missing execute on smoke_proc()';
  end if;
end
$assert$;

set role service_role;
insert into public.wisecall_follow_ups (profile_id, title)
values ('00000000-0000-0000-0000-000000000001', 'service write');
insert into public.wisecall_billing (user_id)
values ('00000000-0000-0000-0000-000000000002');
insert into public.sms_messages (recipient) values ('+447700900123');
select public.smoke_ok();
call public.smoke_proc();
reset role;

do $anon_denied$
begin
  begin
    execute 'set local role anon';
    insert into public.wisecall_follow_ups (profile_id, title)
    values ('00000000-0000-0000-0000-000000000003', 'anon write');
    raise exception 'anon insert into wisecall_follow_ups succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    execute 'set local role anon';
    insert into public.wisecall_billing (user_id)
    values ('00000000-0000-0000-0000-000000000004');
    raise exception 'anon insert into wisecall_billing succeeded';
  exception
    when insufficient_privilege then
      null;
  end;

  begin
    execute 'set local role anon';
    perform public.smoke_ok();
    raise exception 'anon executed smoke_ok()';
  exception
    when insufficient_privilege then
      null;
  end;
end
$anon_denied$;

-- Second apply stays a no-op success.
\i supabase/migrations/20261027120000_data_api_grants.sql

do $still$
begin
  if has_table_privilege('anon', 'public.wisecall_follow_ups', 'INSERT') then
    raise exception 'second apply restored anon insert';
  end if;
  if not has_table_privilege('service_role', 'public.wisecall_billing', 'INSERT') then
    raise exception 'second apply dropped service_role insert';
  end if;
  if (select count(*) from public.wisecall_follow_ups) <> 1 then
    raise exception 'grants migration changed follow-up rows';
  end if;
  if (select count(*) from public.wisecall_billing) <> 1 then
    raise exception 'grants migration changed billing rows';
  end if;
end
$still$;
