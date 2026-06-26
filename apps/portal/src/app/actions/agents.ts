"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";
import type {
  AgentRouting,
  KnowledgeFields,
  OfficeHours,
  RoutingContact,
} from "@/components/customer-agent-workspace";
import {
  type IntegrationWebhook,
  serializeIntegrationWebhooks,
} from "@/lib/integration-webhooks";

export type AgentPatch = {
  name?: string;
  businessName?: string;
  industry?: string;
  phoneNumber?: string;
  timezone?: string;
  prompt?: string;
  greeting?: string;
  voice?: string;
  knowledge?: string;
  knowledgeFields?: KnowledgeFields;
  website?: string;
  fallbackEmail?: string;
  transferNumber?: string;
  defaultEmail?: string;
  contacts?: RoutingContact[];
  officeHours?: OfficeHours;
  outOfHoursMessage?: string;
  chatAccentColor?: string;
  chatBackgroundColor?: string;
  status?: "Live" | "Setup" | "Review";
  integrationWebhooks?: IntegrationWebhook[];
};

// Builds the legacy transfer_routes object (keyed route → { label, phone,
// timeout_secs }) from the canonical contacts list, so the existing call
// pipeline keeps routing transfers without any backend change.
function toTransferRoutes(
  contacts: RoutingContact[],
): Record<string, { label: string; phone: string; timeout_secs: number }> {
  const routes: Record<string, { label: string; phone: string; timeout_secs: number }> = {};
  for (const c of contacts) {
    const phone = (c.phone ?? "").trim();
    if (!c.transfer || !phone) continue;
    const key = slugify(c.name).replace(/-/g, "_") || c.id;
    routes[key] = { label: c.name.trim() || key, phone, timeout_secs: 25 };
  }
  return routes;
}

export type UpdateResult = { ok: boolean; error?: string };

export type NewAgent = {
  name: string; // receptionist name
  businessName: string;
  industry: string;
  prompt: string;
  greeting?: string;
  voice?: string;
  knowledge?: string;
  knowledgeFields?: KnowledgeFields;
  contacts?: RoutingContact[];
  timezone?: string;
};

export type CreateResult = {
  ok: boolean;
  id?: string;
  error?: string;
  routing?: { provider: "telnyx" | null; number: string; status: "unprovisioned" | "pending" | "live" };
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// Creates a brand-new agent owned by the signed-in user. The first real DDI for
// an owner is included and goes live when assignment succeeds. Extra numbered
// agents stay in setup until an additional number is provisioned/charged.
export async function createAgent(input: NewAgent): Promise<CreateResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Billing gate: customers must be trialing/active to create an agent.
  if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
    return { ok: false, error: "Start your free trial first." };
  }

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: existingNumberedAgents, error: numberReadError } = await service
    .from("wisecall_profiles")
    .select("id,telnyx_number")
    .eq("metadata->>owner_id", user.id)
    .not("telnyx_number", "is", null);
  if (numberReadError) return { ok: false, error: numberReadError.message };

  const hasIncludedNumber = (existingNumberedAgents ?? []).some((row) => {
    const number = String(row.telnyx_number ?? "").trim();
    return number.startsWith("+");
  });
  const shouldAssignIncludedNumber = !hasIncludedNumber;

  const base = slugify(`${input.name}-${input.businessName}`) || "agent";
  const slug = `${base}-${crypto.randomUUID().slice(0, 8)}`;

  const metadata: Record<string, unknown> = {
    owner_id: user.id,
    industry: input.industry,
    source: "portal_create",
    greeting: input.greeting ?? "",
    voice: input.voice ?? "Gemma",
    knowledge: input.knowledge ?? "",
    knowledge_fields: input.knowledgeFields ?? {},
    default_routing_email: "",
    routing_contacts: input.contacts ?? [],
    transfer_routes: toTransferRoutes(input.contacts ?? []),
  };

  const { data, error } = await service
    .from("wisecall_profiles")
    .insert({
      slug,
      profile_name: `${input.businessName} Receptionist`,
      business_name: input.businessName,
      clinic_name: input.businessName,
      receptionist_name: input.name,
      system_prompt: input.prompt,
      greeting: input.greeting ?? "",
      business_context: input.knowledge ?? "",
      timezone: input.timezone ?? "Europe/London",
      is_active: false,
      metadata,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  const profileId = data.id as string;

  let routing: CreateResult["routing"] = { provider: null, number: "", status: "unprovisioned" };

  if (process.env.WISECALL_ROUTING_PROVIDER === "mor_sip") {
    // MOR path: every new agent gets its own DDI from the MOR pool. No Telnyx
    // involvement — existing Telnyx agents are completely untouched.
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supabaseUrl && serviceKey) {
        const fnRes = await fetch(
          `${supabaseUrl}/functions/v1/wisecall-provision-mor-agent`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", apikey: serviceKey },
            body: JSON.stringify({ profile_id: profileId }),
          }
        );
        const fnBody = await fnRes.json();
        if (fnBody.ok) {
          routing = fnBody.routing as CreateResult["routing"];
        } else {
          console.error("MOR provisioning failed:", fnBody.error);
        }
      }
    } catch (morErr) {
      console.error("MOR provision call failed:", (morErr as Error).message);
    }
  } else if (shouldAssignIncludedNumber) {
    // Telnyx path: auto-assign one included pooled DDI per owner. Pooled numbers
    // already point at the shared TeXML app and the runtime routes by called
    // number, so setting telnyx_number + is_active is enough to make the agent answer.
    try {
      const { data: assigned } = await service.rpc("wisecall_assign_pool_number", {
        p_profile_id: profileId,
      });
      if (assigned) {
        // A number was free: wire it up and go live. is_active MUST be set in the
        // same write — the call runtime only matches profiles where is_active=true
        // (wisecallConfigStore), so a number without is_active answers "not
        // configured yet".
        await service
          .from("wisecall_profiles")
          .update({
            telnyx_number: assigned,
            is_active: true,
            metadata: {
              ...metadata,
              routing: { provider: "telnyx", number: assigned, status: "live" },
            },
          })
          .eq("id", profileId);
        routing = { provider: "telnyx", number: assigned as string, status: "live" };
      } else {
        // Pool was empty (e.g. a burst of signups drained it). Flag the agent as
        // awaiting a number and show the "provisioning" state, instead of a dead
        // "Assign number" button. wisecall-pool-replenish picks these up and
        // assigns + activates a number automatically once the pool refills.
        await service
          .from("wisecall_profiles")
          .update({
            metadata: {
              ...metadata,
              awaiting_number: true,
              routing: { provider: "telnyx", number: "", status: "pending" },
            },
          })
          .eq("id", profileId);
        routing = { provider: "telnyx", number: "", status: "pending" };
      }
    } catch (poolErr) {
      console.error("pool number assign failed:", (poolErr as Error).message);
    }
  }

  revalidatePath("/dashboard");
  return { ok: true, id: profileId, routing };
}

export type DeleteResult = { ok: boolean; releasedNumber?: string | null; error?: string };

// Permanently removes an agent and returns its pooled DDI (if any) to the shared
// pool so the next first-number agent can reuse it. Admin-only on purpose:
// customers cancel by giving notice rather than self-serve deleting, so this is
// only ever invoked from the backend/admin side — there is no client delete UI.
export async function deleteAgent(agentId: string): Promise<DeleteResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isAdmin(user)) return { ok: false, error: "Admins only." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  // Confirm the agent exists before touching anything.
  const { data: row, error: readError } = await service
    .from("wisecall_profiles")
    .select("id")
    .eq("id", agentId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "Agent not found." };

  // Delete the profile first. There's no FK from wisecall_number_pool to
  // profiles, so the pool row survives and is still matched by
  // assigned_profile_id when we release it next.
  const { error: deleteError } = await service
    .from("wisecall_profiles")
    .delete()
    .eq("id", agentId);
  if (deleteError) return { ok: false, error: deleteError.message };

  // Free the pooled DDI (if one was assigned). Returns the freed number, or null
  // when the agent had no pool number. The agent is already gone, so a release
  // failure must not fail the whole action — the number can still be reclaimed by
  // the Stripe-cancellation path or a replenish job.
  let releasedNumber: string | null = null;
  const { data: released, error: releaseError } = await service.rpc(
    "wisecall_release_pool_number",
    { p_profile_id: agentId },
  );
  if (releaseError) {
    console.error("pool number release failed on delete:", releaseError.message);
  } else {
    releasedNumber = (released as string | null) ?? null;
  }

  revalidatePath("/dashboard");
  return { ok: true, releasedNumber };
}

// Persists edits to an agent. Ownership is enforced server-side: the row is
// only updated if its metadata.owner_id matches the signed-in user, so a user
// can never edit another customer's agent by guessing an id.
export async function updateAgent(
  agentId: string,
  patch: AgentPatch,
): Promise<UpdateResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  // Billing gate: customers must be trialing/active to edit an agent.
  if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
    return { ok: false, error: "Start your free trial first." };
  }

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: row, error: readError } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", agentId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "Agent not found." };

  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  const admin = isAdmin(user);
  if (metadata.owner_id !== user.id && !admin) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  // Merge metadata-held fields without clobbering existing keys.
  const nextMetadata = { ...metadata };
  if (patch.industry !== undefined) nextMetadata.industry = patch.industry;
  if (patch.website !== undefined) nextMetadata.website = patch.website;
  if (patch.fallbackEmail !== undefined) nextMetadata.fallback_email = patch.fallbackEmail;
  if (patch.transferNumber !== undefined) nextMetadata.transfer_number = patch.transferNumber;
  if (patch.greeting !== undefined) nextMetadata.greeting = patch.greeting;
  if (patch.voice !== undefined) nextMetadata.voice = patch.voice;
  if (patch.knowledge !== undefined) nextMetadata.knowledge = patch.knowledge;
  if (patch.knowledgeFields !== undefined) nextMetadata.knowledge_fields = patch.knowledgeFields;
  if (patch.defaultEmail !== undefined) {
    nextMetadata.default_routing_email = patch.defaultEmail;
  }
  if (patch.contacts !== undefined) {
    // Canonical list the portal owns…
    nextMetadata.routing_contacts = patch.contacts;
    // …mirrored into the legacy structure the live pipeline already reads.
    nextMetadata.transfer_routes = toTransferRoutes(patch.contacts);
  }
  if (patch.officeHours !== undefined) {
    // Per-day open/close the runtime reads for after-hours mode (metadata.office_hours).
    nextMetadata.office_hours = patch.officeHours;
  }
  if (patch.outOfHoursMessage !== undefined) {
    // Mirror in metadata for the portal; the live runtime reads the
    // after_hours_message column (settings.js after-hours greeting), so the
    // column write below is what actually reaches the phone agent.
    nextMetadata.out_of_hours_message = patch.outOfHoursMessage;
  }
  // Website chat widget theming — wisecall-live-chat reads these metadata keys.
  if (patch.chatAccentColor !== undefined) nextMetadata.chat_accent_color = patch.chatAccentColor;
  if (patch.chatBackgroundColor !== undefined) nextMetadata.chat_background_color = patch.chatBackgroundColor;
  if (patch.integrationWebhooks !== undefined) {
    // Custom before/during/after call webhooks (integrationWebhooks.runtime.js).
    nextMetadata.integration_webhooks = serializeIntegrationWebhooks(patch.integrationWebhooks);
  }

  const update: Record<string, unknown> = { metadata: nextMetadata };
  if (patch.name !== undefined) update.receptionist_name = patch.name;
  if (patch.businessName !== undefined) update.business_name = patch.businessName;
  if (patch.timezone !== undefined) update.timezone = patch.timezone;
  if (patch.phoneNumber !== undefined) update.telnyx_number = patch.phoneNumber;
  if (patch.prompt !== undefined) update.system_prompt = patch.prompt;
  // Greeting and knowledge are columns the live runtime reads (greeting,
  // business_context). Write the column so edits reach the phone agent; the
  // metadata copies above stay mirrored for backward compatibility.
  if (patch.greeting !== undefined) update.greeting = patch.greeting;
  if (patch.knowledge !== undefined) update.business_context = patch.knowledge;
  // After-hours message is a column the live runtime reads (settings.js greeting,
  // prompt.js after-hours section). Write it so edits reach the phone agent.
  if (patch.outOfHoursMessage !== undefined) update.after_hours_message = patch.outOfHoursMessage;
  if (patch.status !== undefined) update.is_active = patch.status === "Live";

  // Belt-and-braces ownership filter for customers; admins may edit any agent.
  let writeQuery = service.from("wisecall_profiles").update(update).eq("id", agentId);
  if (!admin) writeQuery = writeQuery.eq("metadata->>owner_id", user.id);
  const { error: writeError } = await writeQuery;

  if (writeError) return { ok: false, error: writeError.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export type TestVoiceResult = {
  ok: boolean;
  audio?: string; // base64 mp3
  mime?: string;
  error?: string;
};

// Cartesia voice catalogue. The real voice UUIDs live in config, not code, so
// each name maps to an env var (CARTESIA_VOICE_<NAME>). Until an id is set for a
// voice, preview returns a clear message instead of failing.
// The Cartesia model used for the in-portal voice preview. Kept in sync with the
// live call pipeline — both default to Sonic 3.5. Override with CARTESIA_MODEL.
const CARTESIA_MODEL = process.env.CARTESIA_MODEL || "sonic-3.5";

const CARTESIA_VOICES: Record<string, string | undefined> = {
  Gemma: process.env.CARTESIA_VOICE_GEMMA,
  Hugo: process.env.CARTESIA_VOICE_HUGO,
  Archie: process.env.CARTESIA_VOICE_ARCHIE,
  Victoria: process.env.CARTESIA_VOICE_VICTORIA,
  Benedict: process.env.CARTESIA_VOICE_BENEDICT,
  Julia: process.env.CARTESIA_VOICE_JULIA,
};

// Synthesises a short sample with the chosen Cartesia voice and returns it as
// base64 mp3 for in-browser playback. The API key stays server-side. Used by the
// "Test voice" button in the agent editor.
export async function testVoice(voice: string, text?: string): Promise<TestVoiceResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const apiKey = process.env.CARTESIA_API_KEY;
  if (!apiKey) return { ok: false, error: "Voice preview isn't switched on yet." };

  const voiceId = CARTESIA_VOICES[voice];
  if (!voiceId) {
    return { ok: false, error: `No voice id is configured for ${voice} yet.` };
  }

  const sample =
    (text || "").trim() ||
    "Hi there, thanks for calling. How can I help you today?";

  try {
    const res = await fetch("https://api.cartesia.ai/tts/bytes", {
      method: "POST",
      headers: {
        "Cartesia-Version": "2024-11-13",
        "X-API-Key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: CARTESIA_MODEL,
        transcript: sample.slice(0, 300),
        voice: { mode: "id", id: voiceId },
        language: "en",
        output_format: {
          container: "mp3",
          sample_rate: 44100,
          bit_rate: 128000,
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return {
        ok: false,
        error: `Voice preview failed (${res.status}). ${detail.slice(0, 140)}`.trim(),
      };
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, audio: buf.toString("base64"), mime: "audio/mpeg" };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Voice preview failed.",
    };
  }
}

export type ProvisionResult = { ok: boolean; routing?: AgentRouting; error?: string };

// Assigns a phone route to an agent. Provider-agnostic by design: the active
// telco stack is chosen via WISECALL_ROUTING_PROVIDER, and each branch is the
// single place to drop in real provisioning once the stack is confirmed.
//
//   telnyx     → DDI → Telnyx → Deepgram (STT) → LLM → Cartesia (TTS)
//   mor_openai → DDI → MOR → SIP → OpenAI Realtime agent
//
// Until a provider is wired, this is a no-op that returns a clear message; the
// rest of the portal (create, ownership, UI) already works around it.
export async function provisionNumber(agentId: string): Promise<ProvisionResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: row, error: readError } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", agentId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!row) return { ok: false, error: "Agent not found." };

  const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
  if (metadata.owner_id !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  const provider = process.env.WISECALL_ROUTING_PROVIDER;

  switch (provider) {
    case "telnyx":
      // TODO: search + order a Telnyx number, attach to the Voice API
      // Application, then persist routing below. Until then:
      return { ok: false, error: "Telnyx provisioning isn't switched on yet." };

    case "mor_sip": {
      // Calls wisecall-provision-mor-agent (loveableowlnetportal) which:
      //   reserves a pool DID → creates MOR user → creates SIP device →
      //   assigns DID to device → inserts wisecall_sip_endpoints (bridge picks
      //   it up in ~30 s) → writes metadata.routing back to the profile.
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseUrl || !serviceKey) {
        return { ok: false, error: "Supabase not configured." };
      }
      const fnUrl = `${supabaseUrl}/functions/v1/wisecall-provision-mor-agent`;
      const fnRes = await fetch(fnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceKey,
        },
        body: JSON.stringify({ profile_id: agentId }),
      });
      const fnBody = await fnRes.json();
      if (!fnBody.ok) {
        return { ok: false, error: fnBody.error || "Provisioning failed." };
      }
      revalidatePath("/dashboard");
      return { ok: true, routing: fnBody.routing as AgentRouting };
    }

    case "mor_openai":
      return { ok: false, error: "MOR / OpenAI routing isn't switched on yet." };

    default:
      return {
        ok: false,
        error:
          "No telco provider is configured yet — we'll switch this on once the routing stack is confirmed.",
      };
  }

  // Reference for when a branch above succeeds — write the route and return it:
  //
  //   const routing: AgentRouting = { provider, number, status: "live", ... };
  //   await service.from("wisecall_profiles")
  //     .update({ metadata: { ...metadata, routing }, telnyx_number: number, is_active: true })
  //     .eq("id", agentId)
  //     .eq("metadata->>owner_id", user.id);
  //   revalidatePath("/dashboard");
  //   return { ok: true, routing };
}

// Lightweight poll used by the portal to detect when a pending agent's number
// has been assigned. Called client-side every ~10 s while any agent shows
// routing.status === "pending". Returns a map of id → { number, status }.
export async function getPendingAgentsStatus(
  ids: string[],
): Promise<Record<string, { number: string; status: "pending" | "live" }>> {
  if (!ids.length) return {};
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return {};
  const service = getServiceSupabase();
  if (!service) return {};

  const { data } = await service
    .from("wisecall_profiles")
    .select("id, telnyx_number, is_active, metadata")
    .in("id", ids)
    .eq("metadata->>owner_id", user.id);

  const result: Record<string, { number: string; status: "pending" | "live" }> = {};
  for (const row of data ?? []) {
    const raw = row.metadata as Record<string, unknown> | null;
    const r = (raw?.routing ?? {}) as Record<string, unknown>;
    const number = typeof r.number === "string" ? r.number : (row.telnyx_number as string | null) ?? "";
    const status = row.is_active && number ? "live" : "pending";
    result[row.id as string] = { number, status };
  }
  return result;
}
