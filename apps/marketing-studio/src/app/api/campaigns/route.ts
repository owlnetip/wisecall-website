import { NextResponse } from "next/server";
import { z } from "zod";
import { generateCampaignPlan } from "@/lib/ai/agents/campaign";
import { PROMPT_VERSION, generateContentDraft } from "@/lib/ai/agents/writer";
import { requireAdminUser } from "@/lib/auth";
import {
  getBrandBySlug,
  getCampaignWithIdeas,
  listResearchFindings,
  saveCampaign,
  saveContentDraft,
  updateCampaignIdeaStatus,
} from "@/lib/marketing/db";
import { isBrandSlug } from "@/lib/marketing/types";

const planSchema = z.object({
  brand_slug: z.string(),
  name: z.string().optional(),
  goal: z.string().optional(),
  duration_days: z.number().min(7).max(90).optional(),
});

const ideaStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["suggested", "approved", "rejected", "drafted"]),
});

const draftIdeaSchema = z.object({
  idea_id: z.string().uuid(),
  brand_slug: z.string(),
});

export async function GET(request: Request) {
  await requireAdminUser();
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("brand");
  const campaignId = searchParams.get("campaign_id");

  if (campaignId) {
    const data = await getCampaignWithIdeas(campaignId);
    if (!data) {
      return NextResponse.json({ error: "Campaign not found." }, { status: 404 });
    }
    return NextResponse.json(data);
  }

  if (!slug || !isBrandSlug(slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const { listCampaigns } = await import("@/lib/marketing/db");
  const campaigns = await listCampaigns(brand.id);
  const approvedFindings = await listResearchFindings(brand.id, { status: "approved" });

  return NextResponse.json({ brand, campaigns, approvedFindings });
}

export async function POST(request: Request) {
  await requireAdminUser();
  const body = await request.json();

  if (body.intent === "update_idea_status") {
    const parsed = ideaStatusSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid idea status." }, { status: 400 });
    }
    const ok = await updateCampaignIdeaStatus(parsed.data.id, parsed.data.status);
    return NextResponse.json({ ok });
  }

  if (body.intent === "draft_idea") {
    const parsed = draftIdeaSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid draft payload." }, { status: 400 });
    }

    if (!isBrandSlug(parsed.data.brand_slug)) {
      return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
    }

    const brand = await getBrandBySlug(parsed.data.brand_slug);
    if (!brand) {
      return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    }

    const campaigns = await import("@/lib/marketing/db");
    const allCampaigns = await campaigns.listCampaigns(brand.id);
    let idea = null;
    for (const c of allCampaigns) {
      const data = await getCampaignWithIdeas(c.id);
      idea = data?.ideas.find((i) => i.id === parsed.data.idea_id) ?? null;
      if (idea) break;
    }

    if (!idea) {
      return NextResponse.json({ error: "Idea not found." }, { status: 404 });
    }

    try {
      const { body: contentBody, model } = await generateContentDraft({
        brand,
        platform: idea.platform,
        topic: idea.topic,
        audience: idea.audience ?? undefined,
        cta: idea.cta ?? undefined,
      });

      const saved = await saveContentDraft({
        brand_id: brand.id,
        platform: idea.platform,
        topic: idea.topic,
        audience: idea.audience,
        cta: idea.cta,
        body: contentBody,
        model,
        prompt_version: PROMPT_VERSION,
        task: "social_post_draft",
      });

      if (saved) {
        await updateCampaignIdeaStatus(idea.id, "drafted", saved.item.id);
      }

      return NextResponse.json({ saved });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Draft failed." },
        { status: 500 },
      );
    }
  }

  const parsed = planSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid campaign payload." }, { status: 400 });
  }

  if (!isBrandSlug(parsed.data.brand_slug)) {
    return NextResponse.json({ error: "Invalid brand slug." }, { status: 400 });
  }

  const brand = await getBrandBySlug(parsed.data.brand_slug);
  if (!brand) {
    return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  }

  const durationDays = parsed.data.duration_days ?? 30;
  const approvedFindings = await listResearchFindings(brand.id, { status: "approved" });

  try {
    const plan = await generateCampaignPlan({
      brand,
      name: parsed.data.name,
      goal: parsed.data.goal,
      durationDays,
      approvedFindings,
    });

    const saved = await saveCampaign({
      brand_id: brand.id,
      name: plan.name,
      goal: plan.goal,
      duration_days: durationDays,
      model: plan.model,
      ideas: plan.ideas,
    });

    return NextResponse.json({ plan, saved });
  } catch (error) {
    console.error("campaign plan failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Campaign planning failed." },
      { status: 500 },
    );
  }
}
