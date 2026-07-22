// wisecall-kb-search, retrieve an agent's knowledge-base chunks for a question.
//
// The voice runtime / chat / email call this when the agent needs to look
// something up in the customer's uploaded documents. Embeds the query with Jina
// (matching how kb-ingest embedded the docs, 1024-dim jina-embeddings-v3) and
// runs the existing search_knowledge_base RPC filtered to this agent's bot id
// (= the wisecall profile id).
//
// POST { profile_id, query, match_count? }  (auth: Supabase anon key, the
// project is at its 100-secret limit, so we rely on standard JWT verification
// rather than a bespoke shared secret; KB content is low-sensitivity business info).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JINA_API_KEY.

import { fetchPropertyBudgetContext } from "../_shared/kb-property-budget-lookup.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wisecall-secret",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type KbMatch = { content: string; title: string | null; similarity: number };
type KbCandidate = { content: string | null; title: string | null; embedding: unknown };

const FALLBACK_LIMIT = 750;
const FALLBACK_MIN_SIMILARITY = 0.35;

async function embedQuery(text: string): Promise<number[] | null> {
  const key = Deno.env.get("JINA_API_KEY");
  if (!key) throw new Error("JINA_API_KEY not configured");
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      task: "retrieval.query",
      dimensions: 1024,
      input: [text],
    }),
  });
  if (!res.ok) throw new Error(`Jina ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? null;
}

function formatPgVector(embedding: number[]): string {
  // Keep enough precision for ranking while avoiding exponential notation, which
  // pgvector's text cast can reject through PostgREST RPC payloads.
  return `[${embedding.map((x) => x.toFixed(12).replace(/\.?0+$/, "") || "0").join(",")}]`;
}

function parsePgVector(value: unknown): number[] {
  if (Array.isArray(value)) {
    return value.map((x) => Number(x));
  }
  if (typeof value !== "string") return [];
  const raw = value.trim().replace(/^\[|\]$/g, "");
  if (!raw) return [];
  return raw.split(",").map((x) => Number(x));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length) return Number.NEGATIVE_INFINITY;
  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    if (!Number.isFinite(av) || !Number.isFinite(bv)) return Number.NEGATIVE_INFINITY;
    dot += av * bv;
    aNorm += av * av;
    bNorm += bv * bv;
  }
  if (!aNorm || !bNorm) return Number.NEGATIVE_INFINITY;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}

async function rpcMatchKnowledgeBase(
  supabaseUrl: string,
  svcKey: string,
  embedding: number[],
  profileId: string,
  matchCount: number,
): Promise<KbMatch[] | null> {
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/wisecall_kb_match`, {
    method: "POST",
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_embedding: formatPgVector(embedding),
      p_bot_id: profileId,
      p_match_count: matchCount,
    }),
  });
  if (!rpcRes.ok) {
    console.error("[wisecall-kb-search] rpc:", rpcRes.status, (await rpcRes.text()).slice(0, 200));
    return null;
  }
  return (await rpcRes.json()) as KbMatch[];
}

async function fallbackMatchKnowledgeBase(
  supabaseUrl: string,
  svcKey: string,
  embedding: number[],
  profileId: string,
  matchCount: number,
): Promise<KbMatch[]> {
  const url =
    `${supabaseUrl}/rest/v1/knowledge_base` +
    `?select=content,title,embedding&bot_ids=cs.{${profileId}}&limit=${FALLBACK_LIMIT}`;
  const res = await fetch(url, {
    headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}` },
  });
  if (!res.ok) {
    console.error("[wisecall-kb-search] fallback:", res.status, (await res.text()).slice(0, 200));
    return [];
  }

  const rows = (await res.json()) as KbCandidate[];
  return rows
    .map((row) => ({
      content: row.content || "",
      title: row.title,
      similarity: cosineSimilarity(embedding, parsePgVector(row.embedding)),
    }))
    .filter((row) => row.content && row.similarity >= FALLBACK_MIN_SIMILARITY)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, matchCount);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let body: { profile_id?: string; query?: string; match_count?: number };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }
  const profileId = (body.profile_id || "").trim();
  const query = (body.query || "").trim();
  const matchCount = Math.min(Math.max(body.match_count ?? 4, 1), 10);
  if (!profileId || !query) return json({ ok: false, error: "profile_id and query are required" }, 400);

  let embedding: number[] | null;
  try {
    embedding = await embedQuery(query);
  } catch (e) {
    console.error("[wisecall-kb-search] embed:", (e as Error).message);
    return json({ ok: false, error: "embedding failed" }, 502);
  }
  if (!embedding || !embedding.length) {
    return json({ ok: false, error: "no embedding returned", chunks: [] }, 502);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !svcKey) return json({ ok: false, error: "Supabase not configured" }, 500);

  // Use the database RPC as the fast path. If it returns no rows, fall back to
  // bounded in-function ranking because the deployed RPC currently filters out
  // valid Jina query matches with a too-high similarity threshold.
  const data =
    (await rpcMatchKnowledgeBase(supabaseUrl, svcKey, embedding, profileId, matchCount)) ?? [];
  const matches = data.length
    ? data
    : await fallbackMatchKnowledgeBase(supabaseUrl, svcKey, embedding, profileId, matchCount);

  const chunks = (matches ?? []).map((r) => ({
    content: r.content,
    title: r.title,
    similarity: r.similarity,
  }));

  const budgetContext = await fetchPropertyBudgetContext(supabaseUrl, svcKey, profileId, query);
  const semanticContext = chunks.length
    ? "[KNOWLEDGE BASE]\n" +
      chunks.map((c: { content: string }) => c.content).join("\n---\n") +
      "\nUse this to answer accurately; don't read it out verbatim."
    : null;
  const context =
    budgetContext && semanticContext
      ? `${budgetContext}\n\n${semanticContext}`
      : budgetContext || semanticContext;

  return json({ ok: true, chunks, context, budget_context: budgetContext || null });
});
