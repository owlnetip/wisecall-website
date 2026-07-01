import { generateObject } from "ai";
import { z } from "zod";
import {
  PROMPT_VERSION,
  estimateCostCents,
  getPolicy,
  resolveModel,
  type AiTask,
} from "@/lib/ai/router";
import { getBrandKnowledge, logModelRun } from "@/lib/marketing/db";
import type { ContentPlatform, DraftResult, MarketingBrand } from "@/lib/marketing/types";
import { getDailyBudgetCents } from "@/lib/env";

const draftSchema = z.object({
  hook: z.string().describe("Opening hook or headline"),
  body: z.string().describe("Main post or article body"),
  cta: z.string().describe("Call to action"),
  hashtags: z.array(z.string()).describe("Suggested hashtags without # prefix"),
  notes: z.string().describe("Brief notes for the human reviewer"),
});

function platformGuidance(platform: ContentPlatform): string {
  switch (platform) {
    case "linkedin":
      return "Write a professional LinkedIn post for UK B2B audiences. Use short paragraphs. 150-250 words.";
    case "facebook":
      return "Write a friendly Facebook post for local UK business owners. Conversational tone. 80-150 words.";
    case "blog":
      return "Write a blog post draft with a clear H1-style title in the hook, subheadings in markdown, and 400-600 words.";
    case "email":
      return "Write a marketing email with subject line in the hook, body copy, and clear CTA. 150-250 words.";
    default:
      return "Write marketing copy appropriate for the platform.";
  }
}

function buildBrandContext(
  brand: MarketingBrand,
  knowledge: Awaited<ReturnType<typeof getBrandKnowledge>>,
): string {
  const grouped = {
    fact: [] as string[],
    tone: [] as string[],
    offer: [] as string[],
    banned_claim: [] as string[],
    audience: [] as string[],
  };

  for (const row of knowledge) {
    const line = row.title ? `${row.title}: ${row.content}` : row.content;
    grouped[row.category].push(line);
  }

  return [
    `Brand: ${brand.name}`,
    brand.tagline ? `Tagline: ${brand.tagline}` : "",
    brand.tone ? `Tone: ${brand.tone}` : "",
    grouped.fact.length ? `Facts:\n- ${grouped.fact.join("\n- ")}` : "",
    grouped.offer.length ? `Offers:\n- ${grouped.offer.join("\n- ")}` : "",
    grouped.audience.length ? `Audiences:\n- ${grouped.audience.join("\n- ")}` : "",
    grouped.banned_claim.length
      ? `NEVER claim or imply:\n- ${grouped.banned_claim.join("\n- ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function runWithPolicy<T>(opts: {
  task: AiTask;
  brandId: string;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
}): Promise<{ object: T; model: string; usage: { inputTokens: number; outputTokens: number } }> {
  const policy = getPolicy(opts.task);
  const models = [policy.model, policy.fallback, policy.escalation].filter(
    (m, i, arr): m is string => Boolean(m) && arr.indexOf(m) === i,
  );

  let lastError: unknown;

  for (const modelId of models) {
    try {
      const result = await generateObject({
        model: resolveModel(modelId),
        schema: opts.schema,
        system: opts.system,
        prompt: opts.prompt,
        maxOutputTokens: policy.maxOutputTokens,
      });

      const inputTokens = result.usage?.inputTokens ?? 0;
      const outputTokens = result.usage?.outputTokens ?? 0;

      await logModelRun({
        brand_id: opts.brandId,
        task: opts.task,
        model: modelId,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_cents: estimateCostCents(modelId, inputTokens, outputTokens),
      });

      return {
        object: result.object,
        model: modelId,
        usage: { inputTokens, outputTokens },
      };
    } catch (error) {
      lastError = error;
      console.error(`Writer agent failed on ${modelId}:`, error);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("All models failed for draft generation.");
}

export async function generateContentDraft(input: {
  brand: MarketingBrand;
  platform: ContentPlatform;
  topic: string;
  audience?: string;
  cta?: string;
  polish?: boolean;
}): Promise<{ draft: DraftResult; model: string; body: string }> {
  const { getDailySpendCents } = await import("@/lib/marketing/db");
  const spent = await getDailySpendCents(input.brand.id);
  const budget = getDailyBudgetCents();

  if (spent >= budget) {
    throw new Error(
      `Daily AI budget reached (${spent}¢ / ${budget}¢). Try again tomorrow or raise MARKETING_DAILY_BUDGET_CENTS.`,
    );
  }

  const knowledge = await getBrandKnowledge(input.brand.id);
  const brandContext = buildBrandContext(input.brand, knowledge);

  const system = [
    "You are an expert UK marketing copywriter.",
    "Follow brand rules exactly. Never invent pricing, certifications or compliance claims.",
    "Use British English spelling.",
    brandContext,
  ].join("\n\n");

  const prompt = [
    platformGuidance(input.platform),
    `Topic: ${input.topic}`,
    input.audience ? `Target audience: ${input.audience}` : "",
    input.cta ? `Preferred CTA: ${input.cta}` : "",
    "Return structured JSON only.",
  ]
    .filter(Boolean)
    .join("\n");

  const task: AiTask = input.platform === "blog" ? "blog_outline" : "social_post_draft";
  const { object, model } = await runWithPolicy({
    task,
    brandId: input.brand.id,
    system,
    prompt,
    schema: draftSchema,
  });

  let draft = object as DraftResult;
  let finalModel = model;

  if (input.polish) {
    const polishPrompt = [
      "Polish this draft for final review. Keep facts unchanged. Improve clarity and hook strength.",
      `Platform: ${input.platform}`,
      JSON.stringify(draft, null, 2),
    ].join("\n\n");

    const polished = await runWithPolicy({
      task: "final_polish",
      brandId: input.brand.id,
      system,
      prompt: polishPrompt,
      schema: draftSchema,
    });

    draft = polished.object as DraftResult;
    finalModel = polished.model;
  }

  const body = [
    draft.hook,
    "",
    draft.body,
    "",
    `CTA: ${draft.cta}`,
    draft.hashtags.length ? `\n#${draft.hashtags.join(" #")}` : "",
    draft.notes ? `\n\nReviewer notes: ${draft.notes}` : "",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  return { draft, model: finalModel, body };
}

export async function extractFactsFromPage(input: {
  brand: MarketingBrand;
  url: string;
  pageText: string;
}): Promise<{ facts: { title: string; content: string; category: string }[]; model: string }> {
  const factSchema = z.object({
    facts: z.array(
      z.object({
        title: z.string(),
        content: z.string(),
        category: z.enum(["fact", "tone", "offer", "audience"]),
      }),
    ),
  });

  const { object, model } = await runWithPolicy({
    task: "brand_fact_extract",
    brandId: input.brand.id,
    system: `Extract marketing-relevant facts from website content for ${input.brand.name}. Do not invent claims.`,
    prompt: `Source URL: ${input.url}\n\nPage content:\n${input.pageText.slice(0, 12000)}`,
    schema: factSchema,
  });

  return { facts: object.facts, model };
}

export { PROMPT_VERSION };
