// WiseCall WhatsApp channel (Twilio Programmable Messaging, or Vonage Messages API).
//
// POST = inbound WhatsApp message from Twilio (form-encoded) or Vonage (JSON,
// `?token=` = smsStatusToken("wisecall-whatsapp-inbound")); the provider is
// detected from the request and the reply goes back the same way → resolve the receiving number to
// the agent (wisecall_whatsapp_numbers.whatsapp_number stores E.164 number) →
// gate on active plan → AI reply from agent prompt + knowledge base → send via
// Twilio Messages API → record usage → contact memory update.
//
// Secrets: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, VONAGE_API_KEY/SECRET (Vonage
// numbers), CLAUDE_API_WISECASE,
// OPENAI_API_KEY, SUPABASE_URL/SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt.
// Set this function URL as the inbound webhook in:
//   Twilio Console → Messaging → Senders → WhatsApp sender → Webhook URL
// Vonage: set it as the Inbound URL of the Messages application linked to the
//   WhatsApp number, with `?token=<token>` appended.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildMemoryBlock, loadContactContext, triggerPortalAnalysis } from "../_shared/contact-memory.ts";
import { fetchMergedKbContext, PROPERTY_BUDGET_PROMPT_RULES } from "../_shared/kb-context.ts";
import { tryHandleViewingReply } from "../_shared/viewing-confirm.ts";
import { smsStatusToken } from "../_shared/sms-status-token.ts";
import { sendVonageWhatsapp } from "../_shared/vonage-messages.ts";

const CLAUDE_MODEL = "claude-opus-4-8";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function twiml(status = 200) {
  return new Response("<Response></Response>", {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

function formValue(form: URLSearchParams, name: string): string {
  return (form.get(name) || "").trim();
}

function normaliseWhatsappAddress(value: string): string {
  return value.replace(/^whatsapp:/i, "").replace(/\s+/g, "").trim();
}

function whatsappNumberCandidates(value: string): string[] {
  const normalised = normaliseWhatsappAddress(value);
  const digitsOnly = normalised.replace(/\D/g, "");
  return [...new Set([normalised, digitsOnly, digitsOnly ? `+${digitsOnly}` : ""].filter(Boolean))];
}

function twilioWhatsappAddress(value: string): string {
  const e164 = normaliseWhatsappAddress(value);
  return e164.toLowerCase().startsWith("whatsapp:") ? e164 : `whatsapp:${e164}`;
}

function isSandboxNumber(value: string): boolean {
  return whatsappNumberCandidates(value).includes("14155238886");
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;

  let diff = 0;
  for (let i = 0; i < aBytes.length; i += 1) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

function twilioWebhookUrlCandidates(req: Request): string[] {
  const candidates = [req.url];
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.replace(/\/+$/, "");
  if (supabaseUrl) {
    candidates.push(`${supabaseUrl}/functions/v1/wisecall-whatsapp-inbound`);
  }

  return [...new Set(candidates.flatMap((url) => [url, url.endsWith("/") ? url.slice(0, -1) : `${url}/`]))];
}

async function verifyTwilioSignature(req: Request, form: URLSearchParams): Promise<boolean> {
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const signature = req.headers.get("x-twilio-signature") || "";

  if (!authToken || !signature) return false;

  const params = [...form.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}${value}`)
    .join("");

  for (const url of twilioWebhookUrlCandidates(req)) {
    const expected = await hmacSha1Base64(authToken, url + params);
    if (await timingSafeEqual(signature, expected)) return true;
  }

  return false;
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

async function callOpenAi(systemPrompt: string, userMessage: string): Promise<string> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY not configured");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("WISECALL_WHATSAPP_MODEL") || Deno.env.get("WISECALL_CHAT_MODEL") || "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.25,
      max_tokens: 450,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = await res.json();
  return String(data?.choices?.[0]?.message?.content || "").trim();
}

async function fetchKbContext(profileId: string, query: string): Promise<string | null> {
  try {
    return await fetchMergedKbContext(profileId, query);
  } catch (e) {
    console.error("[wisecall-whatsapp-inbound] kb context:", (e as Error).message);
    return null;
  }
}

// Send a WhatsApp text reply via Twilio Programmable Messaging.
// `from` = the agent's WhatsApp Business number (E.164), `to` = customer number.
type Provider = "twilio" | "vonage";

async function sendWhatsapp(provider: Provider, from: string, to: string, body: string): Promise<void> {
  if (provider === "vonage") {
    await sendVonageWhatsapp(
      { from, to, text: body },
      { key: Deno.env.get("VONAGE_API_KEY") || "", secret: Deno.env.get("VONAGE_API_SECRET") || "" },
    );
    return;
  }
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) throw new Error("Twilio credentials not configured");

  const params = new URLSearchParams({
    From: twilioWhatsappAddress(from),
    To: twilioWhatsappAddress(to),
    Body: body,
  });

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`WhatsApp send ${res.status}: ${t.slice(0, 300)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "GET") return json({ ok: true });
  if (req.method !== "POST") return twiml();

  const provider: Provider = (req.headers.get("content-type") || "").includes("json") ? "vonage" : "twilio";
  let toNumber = "";
  let fromNumber = "";
  let incoming = "";
  let senderName: string | undefined;
  let messageSid = "";

  if (provider === "vonage") {
    // Vonage Messages API inbound: JSON { channel, from, to, message_uuid, text, profile.name }.
    // Authenticated by the derived URL token (the project is at the secret limit).
    const supplied = new URL(req.url).searchParams.get("token") || "";
    const expected = await smsStatusToken("wisecall-whatsapp-inbound");
    if (!expected || !(await timingSafeEqual(supplied, expected))) {
      console.error("[wisecall-whatsapp-inbound] invalid vonage token");
      return twiml(401);
    }
    let event: Record<string, unknown>;
    try {
      event = await req.json();
    } catch {
      return twiml();
    }
    // Status callbacks and non-text/non-WhatsApp events are acknowledged and ignored.
    if (event.channel !== "whatsapp" || event.message_type !== "text") return twiml();
    toNumber = normaliseWhatsappAddress(String(event.to ?? ""));
    fromNumber = normaliseWhatsappAddress(String(event.from ?? ""));
    incoming = String(event.text ?? "").trim();
    const profileInfo = event.profile as { name?: unknown } | undefined;
    senderName = typeof profileInfo?.name === "string" && profileInfo.name.trim() ? profileInfo.name.trim() : undefined;
    messageSid = String(event.message_uuid ?? "");
  } else {
    let form: URLSearchParams;
    try {
      form = new URLSearchParams(await req.text());
    } catch {
      return twiml();
    }

    // Bad signatures are rejected; handled runtime failures below still return
    // 200 TwiML to avoid webhook retry loops.
    if (!(await verifyTwilioSignature(req, form))) {
      console.error("[wisecall-whatsapp-inbound] invalid twilio signature");
      if (Deno.env.get("TWILIO_STRICT_SIGNATURE") !== "false") {
        return twiml(403);
      }
    }

    // Twilio inbound WhatsApp payload is application/x-www-form-urlencoded:
    // From=whatsapp:+447..., To=whatsapp:+44..., Body=..., ProfileName=...
    toNumber = normaliseWhatsappAddress(formValue(form, "To"));
    fromNumber = normaliseWhatsappAddress(formValue(form, "From"));
    incoming = formValue(form, "Body");
    senderName = formValue(form, "ProfileName") || undefined;
    messageSid = formValue(form, "MessageSid") || formValue(form, "SmsMessageSid");
  }

  // Always 200 for handled cases, non-200 triggers retries.
  try {
    if (!toNumber || !fromNumber || !incoming) {
      return twiml();
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the receiving WhatsApp number → agent.
    // whatsapp_number stores the E.164 WhatsApp Business number. phone_number_id
    // is also checked for rows created while the older Meta/Vonage draft was in use.
    const toCandidates = whatsappNumberCandidates(toNumber);
    const { data: waByNumber } = await supabase
      .from("wisecall_whatsapp_numbers")
      .select("profile_id, status")
      .in("whatsapp_number", toCandidates)
      .maybeSingle();
    const { data: waByLegacyId } = waByNumber?.profile_id
      ? { data: null }
      : await supabase
          .from("wisecall_whatsapp_numbers")
          .select("profile_id, status")
          .in("phone_number_id", toCandidates)
          .maybeSingle();
    const waNumber = waByNumber || waByLegacyId;
    if (!waNumber?.profile_id || waNumber.status !== "active") {
      return twiml();
    }

    const { data: profile } = await supabase
      .from("wisecall_profiles")
      .select("id, business_name, clinic_name, profile_name, system_prompt, business_context, metadata")
      .eq("id", waNumber.profile_id)
      .maybeSingle();
    if (!profile) return twiml();

    const ownerId = (profile.metadata as Record<string, string> | null)?.owner_id;
    if (!ownerId) return twiml();

    const { data: billingRow } = await supabase
      .from("wisecall_billing")
      .select("status")
      .eq("user_id", ownerId)
      .maybeSingle();
    const sandboxBillingBypass =
      isSandboxNumber(toNumber) && Deno.env.get("WISECALL_WHATSAPP_SANDBOX_BYPASS_BILLING") === "true";
    if (!sandboxBillingBypass && (!billingRow || !["active", "trialing"].includes(billingRow.status))) {
      return twiml();
    }

    const businessName =
      profile.business_name || profile.clinic_name || profile.profile_name || "the business";

    // Owner / viewer YES·NO·CHANGE replies for property viewings take priority
    // over the normal AI receptionist path.
    try {
      const viewing = await tryHandleViewingReply({
        supabase,
        profileId: profile.id,
        fromPhone: fromNumber,
        body: incoming,
        channel: "whatsapp",
        businessName: String(businessName).slice(0, 40),
        sendTo: async (to, text) => {
          // Prefer WhatsApp for the counterparty notify; both providers take E.164.
          await sendWhatsapp(provider, toNumber, to, text);
        },
      });
      if (viewing.handled) {
        try {
          await sendWhatsapp(provider, toNumber, fromNumber, viewing.replyText);
        } catch (e) {
          console.error("[wisecall-whatsapp-inbound] viewing reply send:", (e as Error).message);
        }
        try {
          await supabase.rpc("wisecall_record_whatsapp_message", { p_profile_id: profile.id });
        } catch (e) {
          console.error("[wisecall-whatsapp-inbound] usage record:", (e as Error).message);
        }
        console.log(
          "[wisecall-whatsapp-inbound] viewing reply handled",
          viewing.viewingId,
          viewing.intent,
          viewing.status,
        );
        return twiml();
      }
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] viewing handler:", (e as Error).message);
    }

    const contactContext = await loadContactContext(supabase, profile.id, { phone: fromNumber });
    const memoryBlock = buildMemoryBlock(contactContext);
    const contact = contactContext.contact;

    const kbContext = await fetchKbContext(profile.id, incoming);

    const systemPrompt = [
      profile.system_prompt ||
        `You are a helpful, professional UK English receptionist for ${businessName}.`,
      "",
      "*** WHATSAPP CHANNEL ***",
      "You are replying to a customer on WHATSAPP, not on a phone call. Adjust accordingly:",
      "- Write a short, friendly chat-style message (1-4 short sentences). No email greeting/sign-off blocks.",
      "- Use UK English. Be warm, concise and natural, like a helpful person texting back.",
      "- Do not invent availability, prices or confirmations you cannot verify.",
      "- If something needs a human or a booking system, say you'll pass it to the team to follow up, and capture what you can.",
      "- Never mention that you are an AI unless asked directly.",
      "",
      "Using knowledge:",
      "- If a [KNOWLEDGE BASE] block is provided, treat it as authoritative and answer from it.",
      PROPERTY_BUDGET_PROMPT_RULES,
      "- If it doesn't cover the question, you may use general knowledge, but never invent business-specific details (prices, timescales, account specifics). For those, say the team will confirm.",
      profile.business_context ? `\nBusiness knowledge:\n${profile.business_context}` : "",
      kbContext ? `\n${kbContext}` : "",
      memoryBlock ? `\n${memoryBlock}` : "",
      "\nReturn ONLY the message text to send back, no quotes, no labels.",
    ]
      .filter(Boolean)
      .join("\n");

    const userMessage = `The customer (${senderName || fromNumber}) messaged on WhatsApp:\n\n${incoming}`;

    let replyText: string;
    try {
      replyText = await callClaude(systemPrompt, userMessage);
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] LLM error:", (e as Error).message);
      try {
        replyText = await callOpenAi(systemPrompt, userMessage);
      } catch (fallbackError) {
        console.error("[wisecall-whatsapp-inbound] fallback LLM error:", (fallbackError as Error).message);
        replyText = `Thanks for your message, the ${businessName} team will be in touch shortly.`;
      }
    }
    if (!replyText) {
      replyText = `Thanks for your message, the ${businessName} team will be in touch shortly.`;
    }

    try {
      await sendWhatsapp(provider, toNumber, fromNumber, replyText);
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] send error:", (e as Error).message);
      return twiml();
    }

    try {
      await supabase.rpc("wisecall_record_whatsapp_message", { p_profile_id: profile.id });
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] usage record:", (e as Error).message);
    }

    const now = new Date().toISOString();
    let contactId: string | null = (contact?.id as string | undefined) ?? null;
    try {
      if (contact) {
        const patch: Record<string, unknown> = { last_seen: now, updated_at: now };
        if (senderName && !contact.name) patch.name = senderName;
        await supabase.from("wisecall_contacts").update(patch).eq("id", contact.id);
      } else {
        const { data: created } = await supabase
          .from("wisecall_contacts")
          .insert({
            profile_id: profile.id,
            phone: fromNumber,
            name: senderName || null,
            first_seen: now,
            last_seen: now,
          })
          .select("id")
          .single();
        contactId = created?.id ?? null;
      }
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] contact upsert:", (e as Error).message);
    }

    // Log the interaction to the call-logs table (channel = whatsapp) so the
    // conversation appears in Call History alongside phone, email and live chat.
    let callLogId: string | null = null;
    try {
      const { data: logRow } = await supabase.from("wisecall_call_logs").insert({
        call_id: `whatsapp-${messageSid || crypto.randomUUID()}`,
        profile_id: profile.id,
        profile_name: profile.profile_name || businessName,
        caller_id: fromNumber,
        contact_id: contactId,
        summary: `WhatsApp: ${incoming.slice(0, 80)}`,
        outcome: "WhatsApp replied",
        transcript: `FROM: ${senderName || fromNumber}\n\n--- Their message ---\n${incoming}\n\n--- WiseCall reply ---\n${replyText}`,
        started_at: now,
        finished_at: now,
        metadata: { channel: "whatsapp", provider, message_sid: messageSid || null },
      }).select("id").single();
      callLogId = logRow?.id ?? null;
    } catch (e) {
      console.error("[wisecall-whatsapp-inbound] log insert:", (e as Error).message);
    }

    if (callLogId) void triggerPortalAnalysis(callLogId);

    return twiml();
  } catch (e) {
    console.error("[wisecall-whatsapp-inbound] error:", (e as Error).message);
    return twiml();
  }
});
