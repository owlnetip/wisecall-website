# Supabase migrations and Data API grants

Migrations live in two places:

- `supabase/migrations` is what `supabase db reset`, preview branches, and `supabase db push` apply. Several files are mirrors of the portal history.
- `apps/portal/supabase/migrations` is the portal SQL history applied in the Supabase SQL editor or with `supabase db push` against project `zgzzpwaqqftmugzpccpm`.

Do not edit a migration that has already been applied. Add a new file.

From 30 October 2026, a table, sequence, or function created in `public` does not get Data API privileges by itself. PostgREST then returns `42501 permission denied` until a `GRANT` is applied. Row Level Security does not replace that grant.

## New table

Put the grants in the same migration that creates the table. `service_role` is what the portal, edge functions, and voice runtime use. Grant `anon` or `authenticated` only when that migration's caller is the anon key or a signed-in user JWT. The browser Supabase client in this repo is unused, and the server client is only used for `auth.getUser()`.

```sql
create table public.your_table (
  id bigint generated always as identity primary key,
  owner_id uuid not null
);

alter table public.your_table enable row level security;

grant select, insert, update, delete on table public.your_table to service_role;
grant usage, select on sequence public.your_table_id_seq to service_role;
```

`serial`, `bigserial`, and identity columns need the sequence grant or inserts fail even when the table grant is present.

## New function

```sql
create or replace function public.your_function(p_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true;
$$;

-- Data API. Omit anon/authenticated unless a client RPC calls this.
grant execute on function public.your_function(uuid) to service_role;
revoke all on function public.your_function(uuid) from PUBLIC, anon, authenticated;
```

Keep `security definer` functions out of `anon` and `authenticated`. `get_app_secret` is the pattern already in the repo.

## Tables anon must not write

These are service-role tables. RLS is on and there is no anon policy. Do not grant `insert`, `update`, `delete`, `truncate`, or `all` to `anon` or `authenticated`:

- `wisecall_outreach_email_events`
- `wisecall_follow_ups`
- `wisecall_agent_memory`
- `wisecall_demo_callback_rate_limits`
- `ofcom_cupid_codes`

`service_role` still gets select, insert, update, and delete. It bypasses RLS.

## Check

`node scripts/check-supabase-grants.mjs` fails when a migration newer than `20261027120000_data_api_grants.sql` / `0040_data_api_grants.sql` creates a public table without a `service_role` grant in that same file, or when any migration grants anon/authenticated writes on the five tables above.
