-- Data API grants for public objects (OWL-120).
--
-- From 30 Oct 2026, new tables, sequences, and functions in public no longer
-- receive automatic privileges for anon, authenticated, or service_role.
-- Existing production grants are left in place. This migration only adds the
-- privileges a rebuilt schema needs, and removes anon/authenticated writes on
-- the five tables locked down in OWL-121.
--
-- It is idempotent and does not insert, update, or delete rows.
--
-- service_role: select, insert, update, delete on public tables and views we
-- own; usage, select on sequences we own; execute on routines we own.
-- anon / authenticated: no new privileges. Nothing in this repo reads or writes
-- public tables through the anon key or a user JWT. The browser client is
-- unused, and the server client is only used for auth.getUser().
--
-- data-api-grants: service_role on existing public relations

grant usage on schema public to service_role;

do $data_api_grants$
declare
  rel record;
  seq record;
  fn record;
  owner_oid oid;
  sensitive text[] := array[
    'wisecall_outreach_email_events',
    'wisecall_follow_ups',
    'wisecall_agent_memory',
    'wisecall_demo_callback_rate_limits',
    'ofcom_cupid_codes'
  ];
  sensitive_table text;
begin
  -- Tables, views, and foreign tables. Materialized views accept select only.
  for rel in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'f', 'm')
      and pg_catalog.pg_has_role(c.relowner, 'USAGE')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  loop
    if rel.relkind = 'm' then
      execute format('grant select on table public.%I to service_role', rel.relname);
    else
      execute format(
        'grant select, insert, update, delete on table public.%I to service_role',
        rel.relname
      );
    end if;
  end loop;

  for seq in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'S'
      and pg_catalog.pg_has_role(c.relowner, 'USAGE')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_class'::regclass
          and d.objid = c.oid
          and d.deptype = 'e'
      )
  loop
    execute format(
      'grant usage, select on sequence public.%I to service_role',
      seq.relname
    );
  end loop;

  for fn in
    select p.proname,
           p.prokind,
           pg_catalog.pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p', 'a', 'w')
      and pg_catalog.pg_has_role(p.proowner, 'USAGE')
      and not exists (
        select 1
        from pg_depend d
        where d.classid = 'pg_proc'::regclass
          and d.objid = p.oid
          and d.deptype = 'e'
      )
  loop
    if fn.prokind = 'p' then
      execute format(
        'grant execute on procedure public.%I(%s) to service_role',
        fn.proname,
        fn.args
      );
    else
      execute format(
        'grant execute on function public.%I(%s) to service_role',
        fn.proname,
        fn.args
      );
    end if;
  end loop;

  -- OWL-121: these tables are service-role only. Anon must not keep write
  -- grants from the old default privileges. Select is left untouched so an
  -- existing reader is not cut off. Missing tables (for example ofcom_cupid_codes
  -- on a project that never created it) are skipped.
  foreach sensitive_table in array sensitive loop
    select c.relowner
      into owner_oid
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = sensitive_table
      and c.relkind in ('r', 'p');

    if not found then
      continue;
    end if;

    if not pg_catalog.pg_has_role(owner_oid, 'USAGE') then
      raise exception
        'public.% exists, but this role cannot revoke anon writes on it',
        sensitive_table;
    end if;

    execute format(
      'revoke insert, update, delete, truncate on table public.%I from PUBLIC, anon, authenticated',
      sensitive_table
    );
  end loop;
end
$data_api_grants$;
