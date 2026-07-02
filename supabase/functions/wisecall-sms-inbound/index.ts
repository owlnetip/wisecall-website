// WiseCall SMS channel (Vonage Numbers API / Messages API).
//
// POST = inbound SMS from Vonage moHttpUrl webhook → resolve the receiving
// number to the agent (wisecall_sms_numbers.sms_number) → gate on active
// plan → AI reply from agent prompt + knowledge base → send reply via Vonage
// Messages API → record usage → update contact memory.
//
// Secrets: VONAGE_API_KEY, VONAGE_API_SECRET, VONAGE_FROM_NUMBER (unused here;
// the agent's own number is used as `from`), CLAUDE_API_WISECASE,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt.
// Set moHttpUrl on each Vonage number to:
//   {SUPABASE_URL}/functions/v1/wisecall-sms-inbound

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildMemoryBlock, loadContactContext, triggerPortalAnalysis } from "../_shared/contact-memory.ts";

const CLAUDE_MODEL = "claude-opus-4-8";
const KB_MIN_SIMILARITY = 0.35;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ok() {
  // 200 with a null body. NB: a 204 is a "null body status" and the Response
  // constructor throws if given any body (even ""), which would surface as a 500.
  return new Response(null, { status: 200 });
}

function formOrJson(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    const p = new URLSearchParams(raw);
    const out: Record<string, string> = {};
    for (const [k, v] of p.entries()) out[k] = v;
    return out;
  }
}

function normaliseE164(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("+") ? value.replace(/\s+/g, "") : `+${digits}`;
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
      max_tokens: 500,
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

async function sendSms(from: string, to: string, text: string): Promise<void> {
  const key = Deno.env.get("VONAGE_API_KEY");
  const secret = Deno.env.get("VONAGE_API_SECRET");
  if (!key || !secret) throw new Error("Vonage credentials not configured");

  const credentials = btoa(`${key}:${secret}`);
  const res = await fetch("https://api.nexmo.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "sms",
      message_type: "text",
      to: to.replace(/\D/g, "").replace(/^\+/, ""),
      from: from.replace(/\D/g, "").replace(/^\+/, ""),
      text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Vonage send ${res.status}: ${body.slice(0, 300)}`);
  }
}

async function fetchKbContext(profileId: string, query: string): Promise<string | null> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !svcKey) return null;
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
    return relevant.length ? "[KNOWLEDGE BASE]\n" + relevant.join("\n---\n") : null;
  } catch (e) {
    console.error("[wisecall-sms-inbound] kb:", (e as Error).message);
    return null;
  }
}

Deno.serve(async (req) => {
  // Vonage delivers inbound SMS as GET (query params) by default on the legacy
  // SMS API, or POST (form/JSON) if configured / via the Messages API. Accept
  // all of them. Start from the query string, then merge any request body.
  const url = new URL(req.url);
  const params: Record<string, string> = {};
  for (const [k, v] of url.searchParams.entries()) params[k] = v;

  if (req.method === "POST") {
    try {
      const bodyParams = formOrJson(await req.text());
      for (const [k, v] of Object.entries(bodyParams)) params[k] = v;
    } catch {
      // ignore unparseable body; query params may still carry the message
    }
  } else if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // Vonage inbound SMS (moHttpUrl): msisdn = sender, to = our number, text = body
  const fromRaw = params["msisdn"] ?? params["from"] ?? "";
  const toRaw   = params["to"]    ?? params["To"]  ?? "";
  const body    = (params["text"] ?? params["Body"] ?? "").trim();
  const messageId = params["messageId"] ?? params["message-uuid"] ?? "";

  // No SMS payload → treat as a health check / delivery-receipt ping.
  if (!fromRaw || !toRaw || !body) {
    console.log("[wisecall-sms-inbound] non-message request", req.method, JSON.stringify(params).slice(0, 200));
    return ok();
  }

  console.log("[wisecall-sms-inbound] inbound", req.method, "from", fromRaw, "to", toRaw);

  const fromNumber = normaliseE164(fromRaw);
  const toNumber   = normaliseE164(toRaw);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve receiving SMS number → agent profile.
    const { data: smsRow } = await supabase
      .from("wisecall_sms_numbers")
      .select("profile_id, status")
      .eq("sms_number", toNumber)
      .maybeSingle();
    if (!smsRow?.profile_id || smsRow.status !== "active") return ok();

    const { data: profile } = await supabase
      .from("wisecall_profiles")
      .select("id, business_name, clinic_name, profile_name, system_prompt, business_context, metadata")
      .eq("id", smsRow.profile_id)
      .maybeSingle();
    if (!profile) return ok();

    const ownerId = (profile.metadata as Record<string, string> | null)?.owner_id;
    if (!ownerId) return ok();

    const { data: billingRow } = await supabase
      .from("wisecall_billing")
      .select("status")
      .eq("user_id", ownerId)
      .maybeSingle();
    if (!billingRow || !["active", "trialing"].includes(billingRow.status)) return ok();

    const businessName =
      profile.business_name || profile.clinic_name || profile.profile_name || "the business";

    const contactContext = await loadContactContext(supabase, profile.id, { phone: fromNumber });
    const memoryBlock = buildMemoryBlock(contactContext);
    const contact = contactContext.contact;

    const kbContext = await fetchKbContext(profile.id, body);

    const systemPrompt = [
      profile.system_prompt ||
        `You are a helpful, professional UK English receptionist for ${businessName}.`,
      "",
      "*** SMS CHANNEL ***",
      "You are replying to a customer via SMS text message. Adjust accordingly:",
      "- Write a short, clear response (1-3 sentences max). No greetings or sign-offs.",
      "- Use UK English. Be warm, concise and direct: text messages should be brief.",
      "- Do not invent availability, prices or confirmations you cannot verify.",
      "- If something needs a human or a booking system, say the team will follow up.",
      "- Never mention that you are an AI unless asked directly.",
      "",
      "Using knowledge:",
      "- If a [KNOWLEDGE BASE] block is provided, treat it as authoritative and answer from it.",
      "- If it doesn't cover the question, use general knowledge but never invent business-specific details (prices, timescales, account specifics). For those, say the team will confirm.",
      profile.business_context ? `\nBusiness knowledge:\n${profile.business_context}` : "",
      kbContext ? `\n${kbContext}` : "",
      memoryBlock ? `\n${memoryBlock}` : "",
      "\nReturn ONLY the SMS text to send, no quotes, no labels, no formatting.",
    ]
      .filter(Boolean)
      .join("\n");

    const userMessage = `The customer (${fromNumber}) sent an SMS:\n\n${body}`;

    let replyText: string;
    try {
      replyText = await callClaude(systemPrompt, userMessage);
    } catch (e) {
      console.error("[wisecall-sms-inbound] LLM error:", (e as Error).message);
      replyText = `Thanks for your message, the ${businessName} team will be in touch shortly.`;
    }
    if (!replyText) {
      replyText = `Thanks for your message, the ${businessName} team will be in touch shortly.`;
    }

    try {
      await sendSms(toNumber, fromNumber, replyText);
    } catch (e) {
      console.error("[wisecall-sms-inbound] send error:", (e as Error).message);
      return ok();
    }

    try {
      await supabase.rpc("wisecall_record_sms_message", { p_profile_id: profile.id });
    } catch (e) {
      console.error("[wisecall-sms-inbound] usage:", (e as Error).message);
    }

    const now = new Date().toISOString();
    let contactId: string | null = (contact?.id as string | undefined) ?? null;
    try {
      if (contact) {
        await supabase.from("wisecall_contacts").update({ last_seen: now, updated_at: now }).eq("id", contact.id);
      } else {
        const { data: created } = await supabase
          .from("wisecall_contacts")
          .insert({ profile_id: profile.id, phone: fromNumber, first_seen: now, last_seen: now })
          .select("id")
          .single();
        contactId = created?.id ?? null;
      }
    } catch (e) {
      console.error("[wisecall-sms-inbound] contact upsert:", (e as Error).message);
    }

    let callLogId: string | null = null;
    try {
      const { data: logRow } = await supabase.from("wisecall_call_logs").insert({
        call_id: `sms-${messageId || crypto.randomUUID()}`,
        profile_id: profile.id,
        profile_name: profile.profile_name || businessName,
        caller_id: fromNumber,
        contact_id: contactId,
        summary: `SMS: ${body.slice(0, 80)}`,
        outcome: "SMS replied",
        transcript: `FROM: ${fromNumber}\n\n--- Their message ---\n${body}\n\n--- WiseCall reply ---\n${replyText}`,
        started_at: now,
        finished_at: now,
        metadata: { channel: "sms", message_id: messageId || null },
      }).select("id").single();
      callLogId = logRow?.id ?? null;
    } catch (e) {
      console.error("[wisecall-sms-inbound] log insert:", (e as Error).message);
    }

    if (callLogId) void triggerPortalAnalysis(callLogId);

    return ok();
  } catch (e) {
    console.error("[wisecall-sms-inbound] error:", (e as Error).message);
    return ok();
  }
});
