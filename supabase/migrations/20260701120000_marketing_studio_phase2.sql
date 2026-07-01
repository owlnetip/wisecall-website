-- Phase 2: Research + Campaign Planner

create table if not exists public.marketing_competitors (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  name text not null,
  website_url text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_research_runs (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  topic text not null,
  status text not null default 'completed' check (status in ('running', 'completed', 'failed')),
  summary text,
  model text,
  sources jsonb default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_research_findings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.marketing_research_runs(id) on delete cascade,
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  category text not null check (category in ('trend', 'competitor', 'keyword', 'opportunity', 'audience_insight')),
  title text not null,
  summary text not null,
  source_url text,
  relevance_score integer check (relevance_score >= 1 and relevance_score <= 10),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  name text not null,
  goal text,
  duration_days integer not null default 30 check (duration_days > 0 and duration_days <= 90),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed')),
  model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.marketing_campaign_ideas (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.marketing_campaigns(id) on delete cascade,
  brand_id uuid not null references public.marketing_brands(id) on delete cascade,
  day_offset integer not null check (day_offset >= 1 and day_offset <= 90),
  platform text not null check (platform in ('linkedin', 'facebook', 'blog', 'email')),
  topic text not null,
  hook text,
  audience text,
  cta text,
  rationale text,
  status text not null default 'suggested' check (status in ('suggested', 'approved', 'rejected', 'drafted')),
  content_item_id uuid references public.marketing_content_items(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists marketing_competitors_brand_id_idx on public.marketing_competitors(brand_id);
create index if not exists marketing_research_runs_brand_id_idx on public.marketing_research_runs(brand_id, created_at desc);
create index if not exists marketing_research_findings_run_id_idx on public.marketing_research_findings(run_id);
create index if not exists marketing_research_findings_brand_status_idx on public.marketing_research_findings(brand_id, status);
create index if not exists marketing_campaigns_brand_id_idx on public.marketing_campaigns(brand_id, created_at desc);
create index if not exists marketing_campaign_ideas_campaign_id_idx on public.marketing_campaign_ideas(campaign_id, day_offset);

alter table public.marketing_competitors enable row level security;
alter table public.marketing_research_runs enable row level security;
alter table public.marketing_research_findings enable row level security;
alter table public.marketing_campaigns enable row level security;
alter table public.marketing_campaign_ideas enable row level security;

create policy "Admins manage competitors" on public.marketing_competitors for all using (public.is_wisecall_admin()) with check (public.is_wisecall_admin());
create policy "Admins manage research runs" on public.marketing_research_runs for all using (public.is_wisecall_admin()) with check (public.is_wisecall_admin());
create policy "Admins manage research findings" on public.marketing_research_findings for all using (public.is_wisecall_admin()) with check (public.is_wisecall_admin());
create policy "Admins manage campaigns" on public.marketing_campaigns for all using (public.is_wisecall_admin()) with check (public.is_wisecall_admin());
create policy "Admins manage campaign ideas" on public.marketing_campaign_ideas for all using (public.is_wisecall_admin()) with check (public.is_wisecall_admin());

-- Seed default competitors per brand
insert into public.marketing_competitors (brand_id, name, website_url, notes)
select b.id, v.name, v.website_url, v.notes
from public.marketing_brands b
cross join (
  values
    ('wisecall', 'Moneypenny', 'https://www.moneypenny.com', 'UK call answering competitor'),
    ('wisecall', 'Receptional', 'https://www.receptional.com', 'Virtual reception services'),
    ('owlnet', 'TelcoSwitch', 'https://www.telcoswitch.com', 'Wholesale UC competitor'),
    ('owlnet', 'Centile', 'https://www.centile.com', 'Hosted UC for resellers')
) as v(slug, name, website_url, notes)
where b.slug = v.slug
  and not exists (
    select 1 from public.marketing_competitors c where c.brand_id = b.id and c.name = v.name
  );
