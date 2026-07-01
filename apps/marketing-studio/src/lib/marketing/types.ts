export const BRAND_SLUGS = ["wisecall", "owlnet"] as const;

export type BrandSlug = (typeof BRAND_SLUGS)[number];

export function isBrandSlug(value: string): value is BrandSlug {
  return (BRAND_SLUGS as readonly string[]).includes(value);
}

export type MarketingBrand = {
  id: string;
  slug: BrandSlug;
  name: string;
  website_url: string | null;
  tone: string | null;
  tagline: string | null;
  created_at: string;
};

export type BrandKnowledge = {
  id: string;
  brand_id: string;
  category: "fact" | "tone" | "offer" | "banned_claim" | "audience";
  title: string | null;
  content: string;
  source_url: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingAudience = {
  id: string;
  brand_id: string;
  name: string;
  description: string | null;
  sector: string | null;
  created_at: string;
};

export type ContentPlatform = "linkedin" | "facebook" | "blog" | "email";

export type ContentItem = {
  id: string;
  brand_id: string;
  platform: ContentPlatform;
  topic: string;
  audience: string | null;
  cta: string | null;
  status: "draft" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
};

export type ContentVersion = {
  id: string;
  content_item_id: string;
  body: string;
  model: string | null;
  prompt_version: string | null;
  task: string | null;
  created_at: string;
};

export type ModelRun = {
  id: string;
  brand_id: string | null;
  task: string;
  model: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_cents: number | null;
  created_at: string;
};

export type DraftResult = {
  hook: string;
  body: string;
  cta: string;
  hashtags: string[];
  notes: string;
};

export type Competitor = {
  id: string;
  brand_id: string;
  name: string;
  website_url: string | null;
  notes: string | null;
  created_at: string;
};

export type ResearchRun = {
  id: string;
  brand_id: string;
  topic: string;
  status: "running" | "completed" | "failed";
  summary: string | null;
  model: string | null;
  sources: { title?: string; url?: string; snippet?: string }[];
  created_at: string;
};

export type ResearchFinding = {
  id: string;
  run_id: string;
  brand_id: string;
  category: "trend" | "competitor" | "keyword" | "opportunity" | "audience_insight";
  title: string;
  summary: string;
  source_url: string | null;
  relevance_score: number | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export type Campaign = {
  id: string;
  brand_id: string;
  name: string;
  goal: string | null;
  duration_days: number;
  status: "draft" | "active" | "completed";
  model: string | null;
  created_at: string;
  updated_at: string;
};

export type CampaignIdea = {
  id: string;
  campaign_id: string;
  brand_id: string;
  day_offset: number;
  platform: ContentPlatform;
  topic: string;
  hook: string | null;
  audience: string | null;
  cta: string | null;
  rationale: string | null;
  status: "suggested" | "approved" | "rejected" | "drafted";
  content_item_id: string | null;
  created_at: string;
};
