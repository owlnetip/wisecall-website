// kb-reembed, re-embed an agent's knowledge-base rows with the current model.
//
// JINA_API_KEY left the project, so kb-ingest and wisecall-kb-search now use
// OpenAI text-embedding-3-small (1024 dims). Rows embedded earlier with Jina
// sit in a different vector space and never match a query. This rewrites one
// bot's rows in batches; re-running is harmless (same text, same vector).
//
// POST { bot_id, after_id?, batch_size? }  ->  { updated, next_after_id, done }
// Call repeatedly with next_after_id until done. Service-role JWT only (verify_jwt on).
// Rows shared with another bot are updated too (the vector is per row).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MODEL = "text-embedding-3-small";
const DIMENSIONS = 1024;
// text-embedding-3-small takes up to 8,192 tokens per input; chunks are far smaller.
const MAX_CHARS = 24_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function embed(texts: string[]): Promise<number[][]> {
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, dimensions: DIMENSIONS, input: texts }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return data.data.map((d: { embedding: number[] }) => d.embedding);
}

// verify_jwt stays on for this function, so the gateway has already checked the
// signature; here we only require that the verified token is the service role.
function isServiceRole(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return claims.role === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isServiceRole(req)) return json({ error: "Unauthorized" }, 401);
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const body = await req.json().catch(() => ({}));
  const botId = String(body.bot_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(botId)) return json({ error: "bot_id (uuid) is required" }, 400);
  const batchSize = Math.min(Math.max(Number(body.batch_size) || 50, 1), 100);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  let query = supabase
    .from("knowledge_base")
    .select("id, content")
    .contains("bot_ids", [botId])
    .not("embedding", "is", null)
    .order("id")
    .limit(batchSize);
  if (body.after_id) query = query.gt("id", String(body.after_id));
  const { data: rows, error } = await query;
  if (error) return json({ error: error.message }, 500);
  if (!rows?.length) return json({ updated: 0, next_after_id: null, done: true });

  const vectors = await embed(rows.map((r) => String(r.content).slice(0, MAX_CHARS)));
  const failed: string[] = [];
  for (let i = 0; i < rows.length; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(async (row, j) => {
      const { error: upErr } = await supabase
        .from("knowledge_base")
        .update({ embedding: JSON.stringify(vectors[i + j]) })
        .eq("id", row.id);
      if (upErr) failed.push(row.id);
    }));
  }

  return json({
    updated: rows.length - failed.length,
    failed,
    next_after_id: rows[rows.length - 1].id,
    done: rows.length < batchSize,
  });
});
