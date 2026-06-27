// WiseCall WhatsApp channel (Meta WhatsApp Cloud API).
//
// GET  = Meta webhook verification (hub.challenge / WHATSAPP_VERIFY_TOKEN).
// POST = inbound WhatsApp message → resolve the receiving phone_number_id to the
//        agent (wisecall_whatsapp_numbers) → gate on an active plan → generate an
//        AI reply from the agent's prompt + knowledge base → send via the Cloud
//        API → record usage against the WhatsApp allowance. Mirrors
//        wisecall-email-inbound. One Meta number per customer/agent.
//
// Secrets: WHATSAPP_VERIFY_TOKEN, WHATSAPP_ACCESS_TOKEN (system-user token that can
// send for the WABA numbers), CLAUDE_API_WISECASE, SUPABASE_URL/SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt (Meta calls it unauthenticated; we don't gate on JWT).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const GRAPH_VERSION = "v19.0";
const CLAUDE_MODEL = "claude-opus-4-8";
const KB_MIN_SIMILARITY = 0.35;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function callClaude(systemPrompt: string, userMessage: string): Promise<string> {
  const key = Deno.env.get("CLAUDE_API_WISECASE");
  if (!key) throw new Error("CLAUDE_API_WISECASE not configured");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b: { type: string }) => b.type === "text");
  return (block?.text || "").trim();
}

// Relevance-gated KB lookup via wisecall-kb-search (scoped to the agent). Never throws.
async function fetchKbContext(profileId: string, query: string): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !svcKey || !profileId || !query) return null;
    const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-kb-search`, {
      method: "POST",
      headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ profile_id: profileId, query, match_count: 4 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const relevant = chunks
      .filter((c: { content?: string; similarity?: number }) =>
        c?.content && typeof c.similarity === "number" && c.similarity >= KB_MIN_SIMILARITY)
      .map((c: { content: string }) => c.content);
    if (!relevant.length) return null;
    return "[KNOWLEDGE BASE]\n" + relevant.join("\n---\n");
  } catch (e) {
    console.error("[wisecall-whatsapp-inbound] kb context:", (e as Error).message);
    return null;
  }
}

// Send a WhatsApp text reply via the Cloud API, from the agent's own number.
async function sendWhatsapp(phoneNumberId: string, to: string, body: string): Promise<void> {
  const token = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  if (!token) throw new Error("WHATSAPP_ACCESS_TOKEN not configured");
  const res = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WhatsApp send ${res.status}: ${t.slice(0, 300)}`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // --- Meta webhook verification handshake ---
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    // The verify token only gates Meta's one-time webhook handshake (it is not a
    // data credential). It falls back to a known string because the Supabase
    // project is at its 100-secret cap; set WHATSAPP_VERIFY_TOKEN to override if a
    // slot frees up. (POST payload integrity should be hardened later via the
    // X-Hub-Signature-256 app-secret signature.)
    const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN") || "wisecall-whatsapp-verify";
    if (mode === "subscribe" && token === expected) {
      return new Response(challenge ?? "", { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  if (req.method !== "POST") return json({ ok: true });

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: true, skipped: "no body" });
  }

  // Always 200 to Meta unless we genuinely can't parse — it retries on non-200.
  try {
    const change = payload?.entry?.[0]?.changes?.[0]?.value;
    const message = change?.messages?.[0];
    // Ignore delivery/read status callbacks and non-text messages for v1.
    if (!message) return json({ ok: true, skipped: "no message (status callback)" });
    if (message.type !== "text") {
      return json({ ok: true, skipped: `unsupported type ${message.type}` });
    }

    const phoneNumberId: string | undefined = change?.metadata?.phone_number_id;
    const fromNumber: string | undefined = message.from; // E.164 without +
    const incoming: string = (message.text?.body || "").trim();
    const senderName: string | undefined = change?.contacts?.[0]?.profile?.name;
    if (!phoneNumberId || !fromNumber || !incoming) {
      return json({ ok: true, skipped: "missing fields" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the receiving WhatsApp number → agent profile.
    const { data: waNumber } = await supabase
      .from("wisecall_whatsapp_numbers")
      .select("profile_id, status")
      .eq("phone_number_id", phoneNumberId)
      .maybeSingle();
    if (!waNumber?.profile_id || waNumber.status !== "active") {
      return json({ ok: true, skipped: `no active agent for ${phoneNumberId}` });
    }

    const { data: profile } = await supabase
      .from("wisecall_profiles")
      .select("id, business_name, clinic_name, profile_name, system_prompt, business_context, metadata")
      .eq("id", waNumber.profile_id)
      .maybeSingle();
    if (!profile) return json({ ok: true, skipped: "agent not found" });

    const ownerId = (profile.metadata as Record<string, string> | null)?.owner_id;
    if (!ownerId) return json({ ok: true, skipped: "no owner" });

    // Gate on an active/trialing plan (WhatsApp is bundled into every plan).
    const { data: billingRow } = await supabase
      .from("wisecall_billing")
      .select("status")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (!billingRow || !["active", "trialing"].includes(billingRow.status)) {
      return json({ ok: true, skipped: "no active plan" });
    }

    const businessName =
      profile.business_name || profile.clinic_name || profile.profile_name || "the business";

    // Contact memory by phone (one source of truth across channels).
    const { data: contact } = await supabase
      .from("wisecall_contacts")
      .select("id, name, call_count, email_count, last_seen, ai_summary, notes")
      .eq("profile_id", profile.id)
      .eq("phone", fromNumber)
      .maybeSingle();

    const memoryLines: string[] = [];
    if (contact) {
      memoryLines.push("[CONTACT MEMORY — you have dealt with this person before]");
      if (contact.name) memoryLines.push(`Name: ${contact.name}`);
      memoryLines.push(`Previous calls: ${contact.call_count}, previous emails: ${contact.email_count}`);
      if (contact.ai_summary) memoryLines.push(`History: ${contact.ai_summary}`);
      if (contact.notes) memoryLines.push(`Notes: ${contact.notes}`);
    }

    const kbContext = await fetchKbContext(profile.id, incoming);

    const systemPrompt = [
      profile.system_prompt ||
        `You are a helpful, professional UK English receptionist for ${businessName}.`,
      "",
      "*** WHATSAPP CHANNEL ***",
      "You are replying to a customer on WHATSAPP, not on a phone call. Adjust accordingly:",
      "- Write a short, friendly chat-style message (1–4 short sentences). No email greeting/sign-off blocks.",
      "- Use UK English. Be warm, concise and natural, like a helpful person texting back.",
      "- Do not invent availability, prices or confirmations you cannot verify.",
      "- If something needs a human or a booking system, say you'll pass it to the team to follow up, and capture what you can.",
      "- Never mention that you are an AI unless asked directly.",
      "",
      "Using knowledge:",
      "- If a [KNOWLEDGE BASE] block is provided, treat it as authoritative and answer from it.",
      "- If it doesn't cover the question, you may use general knowledge, but never invent business-specific details (prices, timescales, account specifics). For those, say the team will confirm.",
      profile.business_context ? `\nBusiness knowledge:\n${profile.business_context}` : "",
      kbContext ? `\n${kbContext}` : "",
      memoryLines.length ? `\n${memoryLines.join("\n")}` : "",
      "\nReturn ONLY the message text to send back — no quotes, no labels.",
    ]
      .filter(Boolean)
      .join("\n");

    const userMessage = `The customer (${senderName || fromNumber}) messaged on WhatsApp:\n\n${incoming}`;

    let replyText: string;
    try {
      replyText = await callClaude(systemPrompt, userMessage);
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] LLM error:", (e as Error).message);
      return json({ ok: true, skipped: "LLM failed" });
    }
    if (!replyText) {
      replyText = `Thanks for your message — the ${businessName} team will be in touch shortly.`;
    }

    try {
      await sendWhatsapp(phoneNumberId, fromNumber, replyText);
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] send error:", (e as Error).message);
      return json({ ok: true, skipped: "send failed" });
    }

    // Record usage against the WhatsApp allowance (fail-soft).
    try {
      await supabase.rpc("wisecall_record_whatsapp_message", { p_profile_id: profile.id });
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] usage record:", (e as Error).message);
    }

    // Upsert the contact by phone.
    const now = new Date().toISOString();
    try {
      if (contact) {
        const patch: Record<string, unknown> = { last_seen: now, updated_at: now };
        if (senderName && !contact.name) patch.name = senderName;
        await supabase.from("wisecall_contacts").update(patch).eq("id", contact.id);
      } else {
        await supabase.from("wisecall_contacts").insert({
          profile_id: profile.id,
          phone: fromNumber,
          name: senderName || null,
          first_seen: now,
          last_seen: now,
        });
      }
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] contact upsert:", (e as Error).message);
    }

    return json({ ok: true, replied: true });
  } catch (e) {
    console.error("[wisecall-whatsapp-inbound] error:", (e as Error).message);
    // Still 200 so Meta doesn't hammer retries on a one-off.
    return json({ ok: true, error: "handled" });
  }
});
