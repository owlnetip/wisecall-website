-- Phase 1 AI Marketing Studio tables

create table if not exists public.marketing_brands (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug in ('wisecall', 'owlnet')),
  name text not null,
  website_url text,
  tone text,
  tagline text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_brand_knowledge (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  category text not null check (category in ('fact', 'tone', 'offer', 'banned_claim', 'audience')),
  title text,
  content text not null,
  source_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_audiences (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  name text not null,
  description text,
  sector text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_content_items (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  platform text not null check (platform in ('linkedin', 'facebook', 'blog', 'email')),
  topic text not null,
  audience text,
  cta text,
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_content_versions (
  id uuid primary key default gen_random_uuid(),
  content_item_id uuid not null references public.marketing_content_items(id) on delete cascade,
  body text not null,
  model text,
  prompt_version text,
  task text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_model_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid references public.marketing_brands(id) on delete set null,
  task text not null,
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cost_cents integer,
  created_at timestamptz not null default now()
);

create index if not exists marketing_brand_knowledge_brand_id_idx
  on public.marketing_brand_knowledge(brand_id);

create index if not exists marketing_audiences_brand_id_idx
  on public.marketing_audiences(brand_id);

create index if not exists marketing_content_items_brand_id_idx
  on public.marketing_content_items(brand_id);

create index if not exists marketing_content_versions_item_id_idx
  on public.marketing_content_versions(content_item_id);

create index if not exists marketing_model_runs_brand_id_created_idx
  on public.marketing_model_runs(brand_id, created_at desc);

alter table public.marketing_brands enable row level security;
alter table public.marketing_brand_knowledge enable row level security;
alter table public.marketing_audiences enable row level security;
alter table public.marketing_content_items enable row level security;
alter table public.marketing_content_versions enable row level security;
alter table public.marketing_model_runs enable row level security;

create policy "Admins manage marketing brands"
  on public.marketing_brands for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Admins manage brand knowledge"
  on public.marketing_brand_knowledge for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Admins manage marketing audiences"
  on public.marketing_audiences for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Admins manage content items"
  on public.marketing_content_items for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Admins manage content versions"
  on public.marketing_content_versions for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

create policy "Admins manage model runs"
  on public.marketing_model_runs for all
  using (public.is_wisecall_admin())
  with check (public.is_wisecall_admin());

-- Seed WiseCall and Owlnet workspaces
insert into public.marketing_brands (slug, name, website_url, tone, tagline)
values
  (
    'wisecall',
    'WiseCall',
    'https://wisecall.io',
    'Professional, approachable, UK-focused. Plain English. No hype.',
    'AI receptionist for UK businesses — never miss a call again.'
  ),
  (
    'owlnet',
    'Owlnet',
    'https://owlnet.io',
    'Expert B2B telecom partner tone. Confident, technical but accessible.',
    'Wholesale voice and unified communications for MSPs and resellers.'
  )
on conflict (slug) do nothing;

insert into public.marketing_brand_knowledge (brand_id, category, title, content, source_url)
select b.id, v.category, v.title, v.content, v.source_url
from public.marketing_brands b
cross join (
  values
    ('wisecall', 'fact', 'Core product', 'WiseCall is an AI-powered answering service for UK SMEs. It answers calls 24/7, books appointments, captures leads and sends summaries.', 'https://wisecall.io'),
    ('wisecall', 'offer', 'Free trial', '7-day free trial with up to 20 AI calls. Card required.', 'https://wisecall.io/pricing'),
    ('wisecall', 'banned_claim', 'Medical claims', 'Do not claim WiseCall provides medical advice or replaces clinical staff.', null),
    ('wisecall', 'audience', 'Dentists', 'Dental practices losing enquiries to voicemail and missed calls.', null),
    ('wisecall', 'audience', 'Trades', 'Plumbers, electricians and tradespeople on-site who cannot answer the phone.', null),
    ('owlnet', 'fact', 'Core product', 'Owlnet provides wholesale SIP trunks, hosted PBX and Microsoft Teams voice for MSPs and telecom resellers.', 'https://owlnet.io'),
    ('owlnet', 'offer', 'Partner programme', 'MSP partner programme to add recurring voice revenue without building infrastructure.', null),
    ('owlnet', 'banned_claim', 'Pricing guarantees', 'Do not quote specific wholesale rates without approved pricing sheets.', null),
    ('owlnet', 'audience', 'MSPs', 'Managed service providers wanting to add UC/voice to their stack.', null)
) as v(slug, category, title, content, source_url)
where b.slug = v.slug
  and not exists (
    select 1
    from public.marketing_brand_knowledge k
    where k.brand_id = b.id and k.title = v.title
  );

insert into public.marketing_audiences (brand_id, name, description, sector)
select b.id, v.name, v.description, v.sector
from public.marketing_brands b
cross join (
  values
    ('wisecall', 'UK dentists', 'Dental practices with reception pressure and missed calls.', 'Healthcare'),
    ('wisecall', 'UK trades', 'Trades and field service businesses.', 'Trades'),
    ('owlnet', 'UK MSPs', 'IT managed service providers adding voice.', 'MSP'),
    ('owlnet', 'Telecom resellers', 'Resellers needing wholesale SIP and hosted PBX.', 'Telecom')
) as v(slug, name, description, sector)
where b.slug = v.slug
  and not exists (
    select 1 from public.marketing_audiences a where a.brand_id = b.id and a.name = v.name
  );
