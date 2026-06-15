create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  website_url text,
  industry text,
  created_at timestamptz not null default now()
);

create table if not exists public.customer_memberships (
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (customer_id, user_id)
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.agents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  name text not null,
  industry text,
  status text not null default 'draft' check (status in ('draft', 'requested', 'setup', 'live', 'paused', 'archived')),
  phone_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.demo_agents (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  customer_id uuid references public.customers(id) on delete set null,
  business_name text not null,
  website_url text not null,
  industry text not null,
  prospect_mobile text,
  status text not null default 'requested' check (status in ('requested', 'scraped', 'ready', 'sent', 'clicked', 'converted', 'expired')),
  agent_id uuid references public.agents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.agent_knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.agents(id) on delete cascade,
  demo_agent_id uuid references public.demo_agents(id) on delete cascade,
  source_type text not null default 'website' check (source_type in ('website', 'manual', 'file', 'faq')),
  source_url text,
  title text,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  demo_agent_id uuid references public.demo_agents(id) on delete set null,
  caller_number text,
  status text not null default 'received',
  summary text,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists public.call_transcripts (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  transcript text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.sms_messages (
  id uuid primary key default gen_random_uuid(),
  demo_agent_id uuid references public.demo_agents(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  recipient text not null,
  message text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'delivered', 'failed', 'clicked')),
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customers enable row level security;
alter table public.customer_memberships enable row level security;
alter table public.admin_users enable row level security;
alter table public.agents enable row level security;
alter table public.demo_agents enable row level security;
alter table public.agent_knowledge_sources enable row level security;
alter table public.calls enable row level security;
alter table public.call_transcripts enable row level security;
alter table public.sms_messages enable row level security;

create or replace function public.is_wisecall_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

create or replace function public.user_customer_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select customer_id
  from public.customer_memberships
  where user_id = auth.uid();
$$;

create policy "Admins can read all customers"
  on public.customers for select
  using (public.is_wisecall_admin());

create policy "Members can read own customers"
  on public.customers for select
  using (id in (select public.user_customer_ids()));

create policy "Admins can manage all agents"
  on public.agents for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Members can read own agents"
  on public.agents for select
  using (customer_id in (select public.user_customer_ids()));

create policy "Admins can manage demo agents"
  on public.demo_agents for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Members can read own demo agents"
  on public.demo_agents for select
  using (customer_id in (select public.user_customer_ids()));

create policy "Admins can read calls"
  on public.calls for select
  using (public.is_wisecall_admin());

create policy "Members can read own calls"
  on public.calls for select
  using (customer_id in (select public.user_customer_ids()));

create policy "Admins can read transcripts"
  on public.call_transcripts for select
  using (public.is_wisecall_admin());

create policy "Members can read own transcripts"
  on public.call_transcripts for select
  using (
    exists (
      select 1
      from public.calls
      where calls.id = call_transcripts.call_id
        and calls.customer_id in (select public.user_customer_ids())
    )
  );
