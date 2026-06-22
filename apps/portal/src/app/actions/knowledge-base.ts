"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getSupabaseConfig } from "@/lib/env";
import { getServiceSupabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const CATEGORIES = [
  "OwlnetPBX",
  "Yeastar",
  "SIP",
  "Phones",
  "Internet",
  "NumberPorting",
  "OWLnetApp",
  "General",
] as const;

export type KnowledgeBaseCategory = (typeof CATEGORIES)[number];
export type KnowledgeBaseSourceType = "url" | "sitemap" | "paste" | "upload";

export type KnowledgeBaseSource = {
  source: string;
  title: string;
  category: string;
  chunkCount: number;
  latest: string;
};

export type KnowledgeBaseJob = {
  id: string;
  sourceType: string;
  sourceUrl: string;
  sourceTitle: string;
  category: string;
  status: string;
  chunksAdded: number;
  errorMessage: string;
  startedAt: string;
  finishedAt: string;
};

export type KnowledgeSearchChunk = {
  content: string;
  title: string | null;
  similarity: number;
};

export type KnowledgeBaseListResult = {
  ok: boolean;
  sources: KnowledgeBaseSource[];
  jobs: KnowledgeBaseJob[];
  error?: string;
};

export type KnowledgeBaseMutationResult = {
  ok: boolean;
  jobId?: string;
  chunksAdded?: number;
  error?: string;
};

export type KnowledgeBaseSearchResult = {
  ok: boolean;
  chunks: KnowledgeSearchChunk[];
  error?: string;
};

type ProfileAccessRow = {
  id: string;
  slug: string | null;
  profile_name: string | null;
  business_name: string | null;
  clinic_name: string | null;
  metadata: Record<string, unknown> | null;
};

type KnowledgeSourceRow = {
  source: string | null;
  title: string | null;
  category: string | null;
  chunk_count: number | null;
  latest: string | null;
};

type KnowledgeJobRow = {
  id: string;
  source_type: string | null;
  source_url: string | null;
  source_title: string | null;
  category: string | null;
  status: string | null;
  chunks_added: number | null;
  error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
};

type KnowledgeChunkRow = {
  id: string;
  bot_ids: string[] | null;
};

function isCategory(value: string): value is KnowledgeBaseCategory {
  return (CATEGORIES as readonly string[]).includes(value);
}

async function readUser() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  return user;
}

async function getAccessibleProfile(agentId: string): Promise<{
  ok: true;
  row: ProfileAccessRow;
} | {
  ok: false;
  error: string;
}> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_profiles")
    .select("id, slug, profile_name, business_name, clinic_name, metadata")
    .eq("id", agentId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Agent not found." };

  const row = data as ProfileAccessRow;
  const ownerId = row.metadata?.owner_id;
  if (ownerId !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  return { ok: true, row };
}

async function ensureBotForProfile(row: ProfileAccessRow): Promise<string | null> {
  const service = getServiceSupabase();
  if (!service) return "Server not configured.";

  const name = row.business_name || row.clinic_name || row.profile_name || "WiseCall agent";
  const slug = row.slug || `wisecall-${row.id.slice(0, 8)}`;
  const { error } = await service.from("bots").upsert(
    {
      id: row.id,
      slug,
      name,
      description: "WiseCall portal agent",
      embed_config: {},
      is_archived: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );

  return error?.message ?? null;
}

export async function listKnowledgeBaseSources(agentId: string): Promise<KnowledgeBaseListResult> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, sources: [], jobs: [], error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, sources: [], jobs: [], error: "Server not configured." };

  const [sourcesRes, jobsRes] = await Promise.all([
    service
      .from("knowledge_base_sources_summary")
      .select("source, title, category, chunk_count, latest")
      .contains("bot_ids", [agentId])
      .order("latest", { ascending: false }),
    service
      .from("kb_ingest_jobs")
      .select("id, source_type, source_url, source_title, category, status, chunks_added, error_message, started_at, finished_at")
      .contains("bot_ids", [agentId])
      .order("started_at", { ascending: false })
      .limit(10),
  ]);

  if (sourcesRes.error) {
    return { ok: false, sources: [], jobs: [], error: sourcesRes.error.message };
  }
  if (jobsRes.error) {
    return { ok: false, sources: [], jobs: [], error: jobsRes.error.message };
  }

  const sources = ((sourcesRes.data ?? []) as KnowledgeSourceRow[]).map((row) => ({
    source: row.source || "",
    title: row.title || row.source || "Untitled source",
    category: row.category || "General",
    chunkCount: row.chunk_count ?? 0,
    latest: row.latest || "",
  }));

  const jobs = ((jobsRes.data ?? []) as KnowledgeJobRow[]).map((row) => ({
    id: row.id,
    sourceType: row.source_type || "",
    sourceUrl: row.source_url || "",
    sourceTitle: row.source_title || "",
    category: row.category || "General",
    status: row.status || "",
    chunksAdded: row.chunks_added ?? 0,
    errorMessage: row.error_message || "",
    startedAt: row.started_at || "",
    finishedAt: row.finished_at || "",
  }));

  return { ok: true, sources, jobs };
}

export async function ingestKnowledgeBaseSource(input: {
  agentId: string;
  sourceType: KnowledgeBaseSourceType;
  sourceUrl?: string;
  title?: string;
  text?: string;
  filename?: string;
  category?: string;
}): Promise<KnowledgeBaseMutationResult> {
  const access = await getAccessibleProfile(input.agentId);
  if (!access.ok) return { ok: false, error: access.error };

  const botError = await ensureBotForProfile(access.row);
  if (botError) return { ok: false, error: botError };

  const config = getSupabaseConfig();
  if (!config) return { ok: false, error: "Server not configured." };

  const category = input.category && isCategory(input.category) ? input.category : "General";
  const body: Record<string, unknown> = {
    source_type: input.sourceType,
    category,
    bot_ids: [input.agentId],
    started_by: (await readUser())?.id,
  };

  if (input.sourceType === "url" || input.sourceType === "sitemap") {
    body.source_url = (input.sourceUrl || "").trim();
  } else if (input.sourceType === "paste") {
    body.title = (input.title || "").trim();
    body.text = input.text || "";
  } else {
    body.filename = (input.filename || input.title || "").trim();
    body.text = input.text || "";
  }

  const res = await fetch(`${config.url}/functions/v1/kb-ingest`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success !== true) {
    return {
      ok: false,
      error: typeof data.error === "string" ? data.error : `Ingest failed (${res.status}).`,
    };
  }

  revalidatePath("/dashboard");
  return {
    ok: true,
    jobId: typeof data.job_id === "string" ? data.job_id : undefined,
    chunksAdded: typeof data.chunks_added === "number" ? data.chunks_added : undefined,
  };
}

export async function deleteKnowledgeBaseSource(
  agentId: string,
  source: string,
): Promise<KnowledgeBaseMutationResult> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("knowledge_base")
    .select("id, bot_ids")
    .eq("source", source)
    .contains("bot_ids", [agentId]);

  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as KnowledgeChunkRow[];
  for (const row of rows) {
    const remaining = (row.bot_ids ?? []).filter((id) => id !== agentId);
    const result = remaining.length
      ? await service.from("knowledge_base").update({ bot_ids: remaining }).eq("id", row.id)
      : await service.from("knowledge_base").delete().eq("id", row.id);
    if (result.error) return { ok: false, error: result.error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true, chunksAdded: rows.length };
}

export async function searchKnowledgeBase(
  agentId: string,
  query: string,
): Promise<KnowledgeBaseSearchResult> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, chunks: [], error: access.error };

  const config = getSupabaseConfig();
  if (!config) return { ok: false, chunks: [], error: "Server not configured." };

  const res = await fetch(`${config.url}/functions/v1/wisecall-kb-search`, {
    method: "POST",
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile_id: agentId, query, match_count: 4 }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok !== true) {
    return {
      ok: false,
      chunks: [],
      error: typeof data.error === "string" ? data.error : `Search failed (${res.status}).`,
    };
  }

  return {
    ok: true,
    chunks: Array.isArray(data.chunks) ? (data.chunks as KnowledgeSearchChunk[]) : [],
  };
}
