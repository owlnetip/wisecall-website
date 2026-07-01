// Seed demo knowledge base content for a WiseCall agent profile.
//
// Usage (from apps/portal):
//   node scripts/seed-demo-knowledge-base.mjs --agent=<profile-id>
//   node scripts/seed-demo-knowledge-base.mjs --owner=<auth-user-id>
//
// Requires:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";
import { DEMO_KB_SOURCES, DEMO_KB_TITLE_PREFIX } from "./demo-knowledge-base-data.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const agentId = typeof args.agent === "string" ? args.agent : null;
const ownerId = typeof args.owner === "string" ? args.owner : null;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function resolveAgentId() {
  if (agentId) return agentId;

  if (!ownerId) {
    console.error("Provide --agent=<profile-id> or --owner=<auth-user-id>.");
    process.exit(1);
  }

  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select("id, profile_name, business_name")
    .eq("metadata->>owner_id", ownerId)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(error.message);
    process.exit(1);
  }

  if (!data?.length) {
    console.error(`No profiles found for owner ${ownerId}.`);
    process.exit(1);
  }

  if (data.length > 1) {
    console.log("Multiple profiles found, using the first:");
    for (const row of data) {
      console.log(`  - ${row.id} (${row.business_name || row.profile_name || "unnamed"})`);
    }
  }

  return data[0].id;
}

async function ensureBot(profileId, slug, name) {
  const { error } = await supabase.from("bots").upsert(
    {
      id: profileId,
      slug: slug || `wisecall-${profileId.slice(0, 8)}`,
      name: name || "WiseCall agent",
      description: "WiseCall portal agent",
      embed_config: {},
      is_archived: false,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(error.message);
}

async function existingDemoTitles(profileId) {
  const { data, error } = await supabase
    .from("knowledge_base_sources_summary")
    .select("title")
    .contains("bot_ids", [profileId]);

  if (error) throw new Error(error.message);

  return new Set(
    (data ?? [])
      .map((row) => row.title)
      .filter((title) => typeof title === "string" && title.startsWith(DEMO_KB_TITLE_PREFIX)),
  );
}

async function ingestPaste(profileId, source) {
  const res = await fetch(`${url}/functions/v1/kb-ingest`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source_type: "paste",
      category: source.category,
      bot_ids: [profileId],
      title: source.title,
      text: source.text,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success !== true) {
    throw new Error(typeof data.error === "string" ? data.error : `Ingest failed (${res.status}).`);
  }

  return data.chunks_added ?? 0;
}

async function main() {
  const profileId = await resolveAgentId();

  const { data: profile, error: profileError } = await supabase
    .from("wisecall_profiles")
    .select("id, slug, profile_name, business_name, clinic_name")
    .eq("id", profileId)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error(`Profile not found: ${profileId}`);

  const name = profile.business_name || profile.clinic_name || profile.profile_name || "WiseCall agent";
  await ensureBot(profileId, profile.slug, name);

  const titles = await existingDemoTitles(profileId);
  let added = 0;
  let skipped = 0;
  let totalChunks = 0;

  console.log(`Seeding demo knowledge base for ${profileId} (${name})`);

  for (const source of DEMO_KB_SOURCES) {
    if (titles.has(source.title)) {
      skipped += 1;
      console.log(`  skip  ${source.title}`);
      continue;
    }

    const chunks = await ingestPaste(profileId, source);
    added += 1;
    totalChunks += chunks;
    console.log(`  added ${source.title} (${chunks} chunks)`);
  }

  console.log(`Done: ${added} added, ${skipped} skipped, ${totalChunks} chunks indexed.`);
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
