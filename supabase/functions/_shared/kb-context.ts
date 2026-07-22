import { fetchPropertyBudgetContext } from "./kb-property-budget-lookup.ts";

export const PROPERTY_BUDGET_PROMPT_RULES = [
  "- If a [PROPERTY BUDGET SEARCH] block is provided, use it as the authoritative list for budget/property questions.",
  "- Treat 'under £300k' as up to and including £300,000.",
  "- If nothing is strictly below the caller's budget, suggest the closest listings at or just above it.",
  "- Do not say there are no suitable properties when the budget block lists matches.",
  "- Quote address, price, beds and property reference from the budget block; offer a viewing or team follow-up.",
].join("\n");

type KbSearchResponse = {
  context?: string | null;
  answer?: string | null;
  chunks?: Array<{ content?: string; similarity?: number }>;
};

export async function fetchMergedKbContext(
  profileId: string,
  query: string,
  options: { minSimilarity?: number; matchCount?: number } = {},
): Promise<string | null> {
  const minSimilarity = options.minSimilarity ?? 0.35;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !svcKey || !profileId || !query?.trim()) return null;

  const budgetContext = await fetchPropertyBudgetContext(supabaseUrl, svcKey, profileId, query);
  const matchCount = budgetContext ? Math.max(options.matchCount ?? 4, 6) : (options.matchCount ?? 4);

  let semantic: string | null = null;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-kb-search`, {
      method: "POST",
      headers: {
        apikey: svcKey,
        Authorization: `Bearer ${svcKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profile_id: profileId, query, match_count: matchCount }),
    });
    if (res.ok) {
      const data = (await res.json()) as KbSearchResponse;
      if (typeof data?.context === "string" && data.context.trim()) {
        semantic = data.context.trim();
      } else if (data?.answer) {
        semantic = [
          "[KNOWLEDGE BASE]",
          "VERIFIED PRICE ANSWER (quote these figures; do not say prices are unavailable):",
          String(data.answer),
        ].join("\n");
      } else {
        const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
        const relevant = chunks
          .filter((c) => c?.content && typeof c.similarity === "number" && c.similarity >= minSimilarity)
          .map((c) => c.content as string);
        if (relevant.length) semantic = "[KNOWLEDGE BASE]\n" + relevant.join("\n---\n");
      }
    }
  } catch (e) {
    console.error("[kb-context] semantic search:", (e as Error).message);
  }

  if (budgetContext && semantic) return `${budgetContext}\n\n${semantic}`;
  return budgetContext || semantic;
}
