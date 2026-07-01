import { getServiceSupabase } from "@/lib/supabase";
import type {
  BrandKnowledge,
  BrandSlug,
  Campaign,
  CampaignIdea,
  Competitor,
  ContentItem,
  ContentVersion,
  MarketingAudience,
  MarketingBrand,
  ModelRun,
  ResearchFinding,
  ResearchRun,
} from "@/lib/marketing/types";

export async function getBrandBySlug(slug: BrandSlug): Promise<MarketingBrand | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("marketing_brands")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    console.error("getBrandBySlug:", error.message);
    return null;
  }

  return data as MarketingBrand | null;
}

export async function listBrands(): Promise<MarketingBrand[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_brands")
    .select("*")
    .order("name");

  if (error) {
    console.error("listBrands:", error.message);
    return [];
  }

  return (data ?? []) as MarketingBrand[];
}

export async function getBrandKnowledge(brandId: string): Promise<BrandKnowledge[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_brand_knowledge")
    .select("*")
    .eq("brand_id", brandId)
    .order("category")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getBrandKnowledge:", error.message);
    return [];
  }

  return (data ?? []) as BrandKnowledge[];
}

export async function upsertBrandKnowledge(input: {
  id?: string;
  brand_id: string;
  category: BrandKnowledge["category"];
  title?: string | null;
  content: string;
  source_url?: string | null;
}): Promise<BrandKnowledge | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const payload = {
    brand_id: input.brand_id,
    category: input.category,
    title: input.title ?? null,
    content: input.content,
    source_url: input.source_url ?? null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("marketing_brand_knowledge")
      .update(payload)
      .eq("id", input.id)
      .select("*")
      .single();
    if (error) {
      console.error("upsertBrandKnowledge update:", error.message);
      return null;
    }
    return data as BrandKnowledge;
  }

  const { data, error } = await supabase
    .from("marketing_brand_knowledge")
    .insert(payload)
    .select("*")
    .single();

  if (error) {
    console.error("upsertBrandKnowledge insert:", error.message);
    return null;
  }

  return data as BrandKnowledge;
}

export async function deleteBrandKnowledge(id: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const { error } = await supabase.from("marketing_brand_knowledge").delete().eq("id", id);
  if (error) {
    console.error("deleteBrandKnowledge:", error.message);
    return false;
  }
  return true;
}

export async function listAudiences(brandId: string): Promise<MarketingAudience[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_audiences")
    .select("*")
    .eq("brand_id", brandId)
    .order("name");

  if (error) {
    console.error("listAudiences:", error.message);
    return [];
  }

  return (data ?? []) as MarketingAudience[];
}

export async function listContentItems(brandId: string): Promise<
  (ContentItem & { latest_version?: ContentVersion | null })[]
> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data: items, error } = await supabase
    .from("marketing_content_items")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listContentItems:", error.message);
    return [];
  }

  const rows = (items ?? []) as ContentItem[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const { data: versions } = await supabase
    .from("marketing_content_versions")
    .select("*")
    .in("content_item_id", ids)
    .order("created_at", { ascending: false });

  const latestByItem = new Map<string, ContentVersion>();
  for (const v of (versions ?? []) as ContentVersion[]) {
    if (!latestByItem.has(v.content_item_id)) {
      latestByItem.set(v.content_item_id, v);
    }
  }

  return rows.map((item) => ({
    ...item,
    latest_version: latestByItem.get(item.id) ?? null,
  }));
}

export async function saveContentDraft(input: {
  brand_id: string;
  platform: ContentItem["platform"];
  topic: string;
  audience?: string | null;
  cta?: string | null;
  body: string;
  model: string;
  prompt_version: string;
  task: string;
}): Promise<{ item: ContentItem; version: ContentVersion } | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: item, error: itemError } = await supabase
    .from("marketing_content_items")
    .insert({
      brand_id: input.brand_id,
      platform: input.platform,
      topic: input.topic,
      audience: input.audience ?? null,
      cta: input.cta ?? null,
      status: "draft",
    })
    .select("*")
    .single();

  if (itemError || !item) {
    console.error("saveContentDraft item:", itemError?.message);
    return null;
  }

  const { data: version, error: versionError } = await supabase
    .from("marketing_content_versions")
    .insert({
      content_item_id: item.id,
      body: input.body,
      model: input.model,
      prompt_version: input.prompt_version,
      task: input.task,
    })
    .select("*")
    .single();

  if (versionError || !version) {
    console.error("saveContentDraft version:", versionError?.message);
    return null;
  }

  return { item: item as ContentItem, version: version as ContentVersion };
}

export async function getDailySpendCents(brandId?: string): Promise<number> {
  const supabase = getServiceSupabase();
  if (!supabase) return 0;

  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  let query = supabase
    .from("marketing_model_runs")
    .select("cost_cents")
    .gte("created_at", startOfDay.toISOString());

  if (brandId) {
    query = query.eq("brand_id", brandId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("getDailySpendCents:", error.message);
    return 0;
  }

  return (data ?? []).reduce((sum, row) => sum + (row.cost_cents ?? 0), 0);
}

export async function logModelRun(input: {
  brand_id?: string | null;
  task: string;
  model: string;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_cents?: number | null;
}): Promise<ModelRun | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("marketing_model_runs")
    .insert({
      brand_id: input.brand_id ?? null,
      task: input.task,
      model: input.model,
      input_tokens: input.input_tokens ?? null,
      output_tokens: input.output_tokens ?? null,
      cost_cents: input.cost_cents ?? null,
    })
    .select("*")
    .single();

  if (error) {
    console.error("logModelRun:", error.message);
    return null;
  }

  return data as ModelRun;
}

export async function updateBrandProfile(
  brandId: string,
  updates: { tone?: string | null; tagline?: string | null },
): Promise<MarketingBrand | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("marketing_brands")
    .update(updates)
    .eq("id", brandId)
    .select("*")
    .single();

  if (error) {
    console.error("updateBrandProfile:", error.message);
    return null;
  }

  return data as MarketingBrand;
}

// --- Phase 2: Research & Campaigns ---

export async function listCompetitors(brandId: string): Promise<Competitor[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_competitors")
    .select("*")
    .eq("brand_id", brandId)
    .order("name");

  if (error) {
    console.error("listCompetitors:", error.message);
    return [];
  }
  return (data ?? []) as Competitor[];
}

export async function listResearchRuns(brandId: string): Promise<ResearchRun[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_research_runs")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("listResearchRuns:", error.message);
    return [];
  }
  return (data ?? []) as ResearchRun[];
}

export async function listResearchFindings(
  brandId: string,
  opts?: { runId?: string; status?: ResearchFinding["status"] },
): Promise<ResearchFinding[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  let query = supabase
    .from("marketing_research_findings")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (opts?.runId) query = query.eq("run_id", opts.runId);
  if (opts?.status) query = query.eq("status", opts.status);

  const { data, error } = await query;
  if (error) {
    console.error("listResearchFindings:", error.message);
    return [];
  }
  return (data ?? []) as ResearchFinding[];
}

export async function saveResearchRun(input: {
  brand_id: string;
  topic: string;
  summary: string;
  model: string;
  sources: ResearchRun["sources"];
  findings: Omit<ResearchFinding, "id" | "run_id" | "brand_id" | "status" | "created_at">[];
}): Promise<{ run: ResearchRun; findings: ResearchFinding[] } | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: run, error: runError } = await supabase
    .from("marketing_research_runs")
    .insert({
      brand_id: input.brand_id,
      topic: input.topic,
      status: "completed",
      summary: input.summary,
      model: input.model,
      sources: input.sources,
    })
    .select("*")
    .single();

  if (runError || !run) {
    console.error("saveResearchRun:", runError?.message);
    return null;
  }

  if (input.findings.length === 0) {
    return { run: run as ResearchRun, findings: [] };
  }

  const { data: findings, error: findingsError } = await supabase
    .from("marketing_research_findings")
    .insert(
      input.findings.map((f) => ({
        run_id: run.id,
        brand_id: input.brand_id,
        category: f.category,
        title: f.title,
        summary: f.summary,
        source_url: f.source_url,
        relevance_score: f.relevance_score,
        status: "pending",
      })),
    )
    .select("*");

  if (findingsError) {
    console.error("saveResearchFindings:", findingsError.message);
    return { run: run as ResearchRun, findings: [] };
  }

  return { run: run as ResearchRun, findings: (findings ?? []) as ResearchFinding[] };
}

export async function updateFindingStatus(
  id: string,
  status: ResearchFinding["status"],
): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const { error } = await supabase
    .from("marketing_research_findings")
    .update({ status })
    .eq("id", id);

  if (error) {
    console.error("updateFindingStatus:", error.message);
    return false;
  }
  return true;
}

export async function listCampaigns(brandId: string): Promise<Campaign[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("marketing_campaigns")
    .select("*")
    .eq("brand_id", brandId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("listCampaigns:", error.message);
    return [];
  }
  return (data ?? []) as Campaign[];
}

export async function getCampaignWithIdeas(
  campaignId: string,
): Promise<{ campaign: Campaign; ideas: CampaignIdea[] } | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: campaign, error } = await supabase
    .from("marketing_campaigns")
    .select("*")
    .eq("id", campaignId)
    .maybeSingle();

  if (error || !campaign) return null;

  const { data: ideas } = await supabase
    .from("marketing_campaign_ideas")
    .select("*")
    .eq("campaign_id", campaignId)
    .order("day_offset");

  return {
    campaign: campaign as Campaign,
    ideas: (ideas ?? []) as CampaignIdea[],
  };
}

export async function saveCampaign(input: {
  brand_id: string;
  name: string;
  goal: string;
  duration_days: number;
  model: string;
  ideas: Omit<CampaignIdea, "id" | "campaign_id" | "brand_id" | "status" | "content_item_id" | "created_at">[];
}): Promise<{ campaign: Campaign; ideas: CampaignIdea[] } | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: campaign, error: campaignError } = await supabase
    .from("marketing_campaigns")
    .insert({
      brand_id: input.brand_id,
      name: input.name,
      goal: input.goal,
      duration_days: input.duration_days,
      status: "draft",
      model: input.model,
    })
    .select("*")
    .single();

  if (campaignError || !campaign) {
    console.error("saveCampaign:", campaignError?.message);
    return null;
  }

  const { data: ideas, error: ideasError } = await supabase
    .from("marketing_campaign_ideas")
    .insert(
      input.ideas.map((idea) => ({
        campaign_id: campaign.id,
        brand_id: input.brand_id,
        day_offset: idea.day_offset,
        platform: idea.platform,
        topic: idea.topic,
        hook: idea.hook,
        audience: idea.audience,
        cta: idea.cta,
        rationale: idea.rationale,
        status: "suggested",
      })),
    )
    .select("*");

  if (ideasError) {
    console.error("saveCampaign ideas:", ideasError.message);
    return { campaign: campaign as Campaign, ideas: [] };
  }

  return { campaign: campaign as Campaign, ideas: (ideas ?? []) as CampaignIdea[] };
}

export async function updateCampaignIdeaStatus(
  id: string,
  status: CampaignIdea["status"],
  contentItemId?: string | null,
): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const payload: Record<string, unknown> = { status };
  if (contentItemId !== undefined) payload.content_item_id = contentItemId;

  const { error } = await supabase.from("marketing_campaign_ideas").update(payload).eq("id", id);

  if (error) {
    console.error("updateCampaignIdeaStatus:", error.message);
    return false;
  }
  return true;
}
