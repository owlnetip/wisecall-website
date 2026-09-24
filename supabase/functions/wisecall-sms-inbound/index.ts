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
import { fetchMergedKbContext, PROPERTY_BUDGET_PROMPT_RULES } from "../_shared/kb-context.ts";
import { tryHandleViewingReply } from "../_shared/viewing-confirm.ts";
import { postSalesforceCallback } from "../_shared/salesforce-sms-callback.ts";

const CLAUDE_MODEL = "claude-opus-4-8";

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

// Keep in sync with normaliseSmsDestination / canonicalSmsDigits in
// apps/portal/src/lib/salesforce-sms.ts. Bindings are stored as those digits.
function canonicalSmsDigits(raw: string): string {
  let number = String(raw || "").trim().replace(/[\s().-]/g, "");
  if (!number) return "";
  if (number.startsWith("00")) number = `+${number.slice(2)}`;
  if (number.startsWith("+")) {
    const digits = number.slice(1).replace(/\D/g, "");
    return /^\d{8,15}$/.test(digits) ? digits : "";
  }
  const digits = number.replace(/\D/g, "");
  if (/^0\d{9,10}$/.test(digits)) return `44${digits.slice(1)}`;
  if (/^\d{8,15}$/.test(digits)) return digits;
  return "";
}

function portalBaseUrl(): string {
  const raw = (
    Deno.env.get("WISECALL_PORTAL_URL") ||
    Deno.env.get("PORTAL_URL") ||
    Deno.env.get("PORTAL_DOMAIN") ||
    Deno.env.get("SITE_URL") ||
    ""
  ).trim().replace(/\/+$/, "");
  if (!raw) return "";
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

// Confirmed Salesforce threads reply to the confirmed recipient. The AI
// receptionist does not answer those messages, including when delivery fails.
async function routeConfirmedSalesforceReply(opts: {
  supabase: ReturnType<typeof createClient>;
  profileId: string;
  fromNumber: string;
  body: string;
  messageId: string;
}): Promise<boolean> {
  const digits = canonicalSmsDigits(opts.fromNumber);
  if (!digits) return false;

  const { data: binding, error } = await opts.supabase
    .from("wisecall_salesforce_sms_bindings")
    .select("id, phone_digits, salesforce_record_id")
    .eq("profile_id", opts.profileId)
    .eq("phone_digits", digits)
    .maybeSingle();
  if (error) {
    console.error("[wisecall-sms-inbound] salesforce binding lookup:", error.message);
    throw new Error("Salesforce binding lookup unavailable");
  }
  if (!binding) return false;

  const secret = Deno.env.get("WISECALL_SALESFORCE_SMS_SECRET") || "";
  const portal = portalBaseUrl();
  if (!secret || !portal) {
    console.error("[wisecall-sms-inbound] salesforce reply not delivered: portal or secret missing");
    await recordUndeliveredSalesforceReply(opts, digits, binding.id, binding.salesforce_record_id, "portal_not_configured");
    return true;
  }

  try {
    const result = await postSalesforceCallback(portal, secret, {
      profile_id: opts.profileId,
      from: opts.fromNumber,
      text: opts.body,
      message_id: opts.messageId || null,
    });
    if (!result.delivered) {
      console.error("[wisecall-sms-inbound] salesforce reply delivery unconfirmed:", result.status);
      await recordUndeliveredSalesforceReply(opts, digits, binding.id, binding.salesforce_record_id, `delivery_unconfirmed_http_${result.status}`);
    }
  } catch (err) {
    console.error("[wisecall-sms-inbound] salesforce reply route:", (err as Error).message);
    await recordUndeliveredSalesforceReply(opts, digits, binding.id, binding.salesforce_record_id, (err as Error).message);
  }
  return true;
}

async function recordUndeliveredSalesforceReply(
  opts: { supabase: ReturnType<typeof createClient>; profileId: string; body: string; messageId: string },
  digits: string,
  bindingId: string,
  recordId: string | null,
  error: string,
) {
  const { error: insertError } = await opts.supabase.from("wisecall_salesforce_sms_messages").insert({
    profile_id: opts.profileId,
    binding_id: bindingId,
    direction: "inbound",
    phone_digits: digits,
    body: opts.body,
    status: "route_failed",
    salesforce_record_id: recordId,
    provider: "salesforce",
    provider_message_id: opts.messageId || null,
    detail: { error },
  });
  if (insertError) {
    console.error("[wisecall-sms-inbound] salesforce reply log:", insertError.message);
  }
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
    return await fetchMergedKbContext(profileId, query);
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

    try {
      const salesforceRouted = await routeConfirmedSalesforceReply({
        supabase,
        profileId: profile.id,
        fromNumber: fromRaw,
        body,
        messageId,
      });
      if (salesforceRouted) return ok();
    } catch (e) {
      console.error("[wisecall-sms-inbound] salesforce route:", (e as Error).message);
      // Unknown routing state must never fall through to the AI receptionist.
      return new Response("Reply routing temporarily unavailable", { status: 503 });
    }

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

    // Owner / viewer YES·NO·CHANGE replies for property viewings take priority
    // over the normal AI receptionist path.
    try {
      const viewing = await tryHandleViewingReply({
        supabase,
        profileId: profile.id,
        fromPhone: fromNumber,
        body,
        channel: "sms",
        businessName: String(businessName).slice(0, 40),
        sendTo: async (to, text) => {
          await sendSms(toNumber, to, text);
        },
      });
      if (viewing.handled) {
        try {
          await sendSms(toNumber, fromNumber, viewing.replyText);
        } catch (e) {
          console.error("[wisecall-sms-inbound] viewing reply send:", (e as Error).message);
        }
        try {
          await supabase.rpc("wisecall_record_sms_message", { p_profile_id: profile.id });
        } catch (e) {
          console.error("[wisecall-sms-inbound] usage:", (e as Error).message);
        }
        console.log(
          "[wisecall-sms-inbound] viewing reply handled",
          viewing.viewingId,
          viewing.intent,
          viewing.status,
        );
        return ok();
      }
    } catch (e) {
      console.error("[wisecall-sms-inbound] viewing handler:", (e as Error).message);
    }

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
      PROPERTY_BUDGET_PROMPT_RULES,
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
