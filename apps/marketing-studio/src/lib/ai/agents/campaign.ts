import { z } from "zod";
import { assertDailyBudget, runWithPolicy } from "@/lib/ai/run";
import { getBrandKnowledge } from "@/lib/marketing/db";
import type { CampaignIdea, MarketingBrand, ResearchFinding } from "@/lib/marketing/types";

const planSchema = z.object({
  campaign_name: z.string(),
  goal: z.string(),
  ideas: z.array(
    z.object({
      day_offset: z.number().min(1).max(90),
      platform: z.enum(["linkedin", "facebook", "blog", "email"]),
      topic: z.string(),
      hook: z.string(),
      audience: z.string(),
      cta: z.string(),
      rationale: z.string(),
    }),
  ),
});

function buildBrandContext(
  brand: MarketingBrand,
  knowledge: Awaited<ReturnType<typeof getBrandKnowledge>>,
): string {
  const lines = knowledge.map((k) => (k.title ? `${k.title}: ${k.content}` : k.content));
  return [`Brand: ${brand.name}`, brand.tagline ?? "", brand.tone ?? "", ...lines]
    .filter(Boolean)
    .join("\n");
}

export async function generateCampaignPlan(input: {
  brand: MarketingBrand;
  name?: string;
  goal?: string;
  durationDays: number;
  approvedFindings: ResearchFinding[];
}): Promise<{
  name: string;
  goal: string;
  ideas: Omit<CampaignIdea, "id" | "campaign_id" | "brand_id" | "status" | "content_item_id" | "created_at">[];
  model: string;
}> {
  await assertDailyBudget(input.brand.id);

  const knowledge = await getBrandKnowledge(input.brand.id);
  const brandContext = buildBrandContext(input.brand, knowledge);

  const findingsBlock = input.approvedFindings
    .map((f) => `- [${f.category}] ${f.title}: ${f.summary}`)
    .join("\n");

  const system = [
    "You are a UK B2B marketing strategist.",
    "Create a practical content calendar with varied platforms and strong hooks.",
    "Use British English. Align with brand rules.",
    brandContext,
  ].join("\n\n");

  const prompt = [
    `Campaign duration: ${input.durationDays} days`,
    input.goal ? `Goal: ${input.goal}` : "",
    input.name ? `Campaign name hint: ${input.name}` : "",
    findingsBlock ? `Approved research findings:\n${findingsBlock}` : "No approved findings yet. Use brand context and UK market best practices.",
    `Generate exactly ${Math.min(input.durationDays, 30)} calendar ideas (one per day for the first ${Math.min(input.durationDays, 30)} days).`,
    "Mix LinkedIn, blog, email and occasional Facebook. Vary audiences and CTAs.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const { object, model } = await runWithPolicy({
    task: "campaign_plan",
    brandId: input.brand.id,
    system,
    prompt,
    schema: planSchema,
  });

  return {
    name: input.name ?? object.campaign_name,
    goal: input.goal ?? object.goal,
    ideas: object.ideas.map((idea) => ({
      day_offset: idea.day_offset,
      platform: idea.platform,
      topic: idea.topic,
      hook: idea.hook,
      audience: idea.audience,
      cta: idea.cta,
      rationale: idea.rationale,
    })),
    model,
  };
}
