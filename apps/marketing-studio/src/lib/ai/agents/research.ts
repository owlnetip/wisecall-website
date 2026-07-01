import { getTavilyApiKey } from "@/lib/env";
import { assertDailyBudget, runWithPolicy } from "@/lib/ai/run";
import { getBrandKnowledge, listCompetitors } from "@/lib/marketing/db";
import type { MarketingBrand, ResearchFinding } from "@/lib/marketing/types";
import { z } from "zod";

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchPageText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { "User-Agent": "WiseCall-Marketing-Studio/2.0" },
    next: { revalidate: 0 },
  });
  if (!response.ok) return "";
  return htmlToText(await response.text()).slice(0, 8000);
}

async function tavilySearch(query: string): Promise<{ title: string; url: string; snippet: string }[]> {
  const apiKey = getTavilyApiKey();
  if (!apiKey) return [];

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: 8,
        include_answer: false,
      }),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (data.results ?? []).map((r) => ({
      title: r.title ?? r.url ?? "Source",
      url: r.url ?? "",
      snippet: r.content ?? "",
    }));
  } catch (error) {
    console.error("Tavily search failed:", error);
    return [];
  }
}

function buildBrandContext(
  brand: MarketingBrand,
  knowledge: Awaited<ReturnType<typeof getBrandKnowledge>>,
): string {
  const lines = knowledge.map((k) => (k.title ? `${k.title}: ${k.content}` : k.content));
  return [`Brand: ${brand.name}`, brand.tagline ?? "", brand.tone ?? "", ...lines]
    .filter(Boolean)
    .join("\n");
}

const findingsSchema = z.object({
  summary: z.string().describe("Executive summary of research for the marketing team"),
  findings: z.array(
    z.object({
      category: z.enum(["trend", "competitor", "keyword", "opportunity", "audience_insight"]),
      title: z.string(),
      summary: z.string(),
      source_url: z.string().optional(),
      relevance_score: z.number().min(1).max(10),
    }),
  ),
});

export async function runBrandResearch(input: {
  brand: MarketingBrand;
  topic: string;
}): Promise<{
  summary: string;
  findings: Omit<ResearchFinding, "id" | "run_id" | "brand_id" | "status" | "created_at">[];
  model: string;
  sources: { title?: string; url?: string; snippet?: string }[];
}> {
  await assertDailyBudget(input.brand.id);

  const [knowledge, competitors] = await Promise.all([
    getBrandKnowledge(input.brand.id),
    listCompetitors(input.brand.id),
  ]);

  const brandContext = buildBrandContext(input.brand, knowledge);
  const searchQuery = `${input.brand.name} ${input.topic} UK marketing trends competitors`;

  const [tavilyResults, ...competitorPages] = await Promise.all([
    tavilySearch(searchQuery),
    ...competitors
      .filter((c) => c.website_url)
      .slice(0, 3)
      .map(async (c) => ({
        title: c.name,
        url: c.website_url!,
        snippet: await fetchPageText(c.website_url!),
      })),
  ]);

  const sources = [...tavilyResults, ...competitorPages].filter((s) => s.snippet || s.url);

  const sourceBlock = sources
    .map((s, i) => `Source ${i + 1}: ${s.title}\nURL: ${s.url}\n${s.snippet?.slice(0, 2000) ?? ""}`)
    .join("\n\n");

  const system = [
    "You are a UK B2B marketing research analyst.",
    "Base findings on provided sources and brand context only. Do not invent statistics.",
    "Focus on actionable content and campaign opportunities.",
    brandContext,
  ].join("\n\n");

  const prompt = [
    `Research topic: ${input.topic}`,
    `Competitors tracked: ${competitors.map((c) => c.name).join(", ") || "none"}`,
    sourceBlock ? `Sources:\n${sourceBlock}` : "No live web sources available. Use brand context to suggest plausible research directions clearly marked as hypotheses.",
    "Return 6-12 structured findings with relevance scores.",
  ].join("\n\n");

  const { object, model } = await runWithPolicy({
    task: sources.length > 0 ? "research_synthesis" : "research_extract",
    brandId: input.brand.id,
    system,
    prompt,
    schema: findingsSchema,
  });

  return {
    summary: object.summary,
    findings: object.findings.map((f) => ({
      category: f.category,
      title: f.title,
      summary: f.summary,
      source_url: f.source_url ?? null,
      relevance_score: f.relevance_score,
    })),
    model,
    sources,
  };
}
