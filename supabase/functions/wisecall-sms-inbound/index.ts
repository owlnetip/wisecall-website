// WiseCall SMS channel (Vonage Numbers API / Messages API).
//
// GET/POST = inbound SMS from Vonage moHttpUrl webhook → resolve the receiving
// number to the agent (wisecall_sms_numbers) → gate on active plan → AI reply
// from agent prompt + knowledge base → send reply via Vonage SMS API → record
// usage → update contact memory.
//
// Vonage validates moHttpUrl with a GET that must return 200 before the webhook
// is saved, and times out slow handlers. ACK immediately, then process with
// EdgeRuntime.waitUntil so Claude + send still complete.
//
// Secrets: VONAGE_API_KEY, VONAGE_API_SECRET, CLAUDE_API_WISECASE,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Deploy with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildMemoryBlock, loadContactContext, triggerPortalAnalysis } from "../_shared/contact-memory.ts";
import { fetchMergedKbContext, PROPERTY_BUDGET_PROMPT_RULES } from "../_shared/kb-context.ts";
import { tryHandleViewingReply } from "../_shared/viewing-confirm.ts";
import {
  canWaitUntil,
  extractInboundSms,
  normaliseE164,
  sendSmsViaVonage,
  smsLookupKeys,
  waitUntil,
} from "../_shared/vonage-sms.ts";

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
  // Vonage's moHttpUrl health check requires 200 OK.
  return new Response(null, { status: 200 });
}

function formOrJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    const p = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const [k, v] of p.entries()) out[k] = v;
    return out;
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
  await sendSmsViaVonage({ apiKey: key, apiSecret: secret, from, to, text });
}

async function fetchKbContext(profileId: string, query: string): Promise<string | null> {
  try {
    return await fetchMergedKbContext(profileId, query);
  } catch (e) {
    console.error("[wisecall-sms-inbound] kb:", (e as Error).message);
    return null;
  }
}

async function resolveSmsNumber(
  supabase: ReturnType<typeof createClient>,
  toRaw: string,
) {
  const keys = smsLookupKeys(toRaw);
  if (!keys.length) return null;
  const digitKeys = [...new Set(keys.map((key) => key.replace(/^\+/, "")))];

  const [byNumber, byVonage] = await Promise.all([
    supabase
      .from("wisecall_sms_numbers")
      .select("profile_id, status, sms_number")
      .in("sms_number", keys),
    supabase
      .from("wisecall_sms_numbers")
      .select("profile_id, status, sms_number")
      .in("vonage_number_id", digitKeys),
  ]);

  if (byNumber.error) {
    console.error("[wisecall-sms-inbound] number lookup:", byNumber.error.message);
  }
  if (byVonage.error) {
    console.error("[wisecall-sms-inbound] vonage id lookup:", byVonage.error.message);
  }

  const rows = [...(byNumber.data ?? []), ...(byVonage.data ?? [])];
  return rows.find((item) => item.status === "active") ?? rows[0] ?? null;
}

async function handleInbound(params: Record<string, unknown>): Promise<void> {
  const inbound = extractInboundSms(params);
  if (!inbound) {
    console.log(
      "[wisecall-sms-inbound] non-message request",
      JSON.stringify(params).slice(0, 200),
    );
    return;
  }

  console.log("[wisecall-sms-inbound] inbound from", inbound.from, "to", inbound.to);

  const fromNumber = normaliseE164(inbound.from);
  const toNumber = normaliseE164(inbound.to);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const smsRow = await resolveSmsNumber(supabase, inbound.to);
  if (!smsRow?.profile_id) {
    console.error("[wisecall-sms-inbound] no SMS number match", {
      to: inbound.to,
      toNumber,
      keys: smsLookupKeys(inbound.to),
    });
    return;
  }
  if (smsRow.status !== "active") {
    console.error("[wisecall-sms-inbound] SMS number not active", smsRow.sms_number);
    return;
  }

  const replyFrom = String(smsRow.sms_number || toNumber);

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, system_prompt, business_context, metadata")
    .eq("id", smsRow.profile_id)
    .maybeSingle();
  if (!profile) {
    console.error("[wisecall-sms-inbound] profile missing", smsRow.profile_id);
    return;
  }

  const ownerId = (profile.metadata as Record<string, string> | null)?.owner_id;
  if (!ownerId) {
    console.error("[wisecall-sms-inbound] profile has no owner_id", profile.id);
    return;
  }

  const { data: billingRow } = await supabase
    .from("wisecall_billing")
    .select("status")
    .eq("user_id", ownerId)
    .maybeSingle();
  if (!billingRow || !["active", "trialing"].includes(billingRow.status)) {
    console.error("[wisecall-sms-inbound] billing not active", {
      ownerId,
      status: billingRow?.status ?? "missing",
    });
    return;
  }

  const businessName =
    profile.business_name || profile.clinic_name || profile.profile_name || "the business";

  try {
    const viewing = await tryHandleViewingReply({
      supabase,
      profileId: profile.id,
      fromPhone: fromNumber,
      body: inbound.text,
      channel: "sms",
      businessName: String(businessName).slice(0, 40),
      sendTo: async (to, text) => {
        await sendSms(replyFrom, to, text);
      },
    });
    if (viewing.handled) {
      try {
        await sendSms(replyFrom, fromNumber, viewing.replyText);
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
      return;
    }
  } catch (e) {
    console.error("[wisecall-sms-inbound] viewing handler:", (e as Error).message);
  }

  const contactContext = await loadContactContext(supabase, profile.id, { phone: fromNumber });
  const memoryBlock = buildMemoryBlock(contactContext);
  const contact = contactContext.contact;

  const kbContext = await fetchKbContext(profile.id, inbound.text);

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

  const userMessage = `The customer (${fromNumber}) sent an SMS:\n\n${inbound.text}`;

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
    await sendSms(replyFrom, fromNumber, replyText);
  } catch (e) {
    console.error("[wisecall-sms-inbound] send error:", (e as Error).message);
    return;
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
      call_id: `sms-${inbound.messageId || crypto.randomUUID()}`,
      profile_id: profile.id,
      profile_name: profile.profile_name || businessName,
      caller_id: fromNumber,
      contact_id: contactId,
      summary: `SMS: ${inbound.text.slice(0, 80)}`,
      outcome: "SMS replied",
      transcript: `FROM: ${fromNumber}\n\n--- Their message ---\n${inbound.text}\n\n--- WiseCall reply ---\n${replyText}`,
      started_at: now,
      finished_at: now,
      metadata: { channel: "sms", message_id: inbound.messageId || null },
    }).select("id").single();
    callLogId = logRow?.id ?? null;
  } catch (e) {
    console.error("[wisecall-sms-inbound] log insert:", (e as Error).message);
  }

  if (callLogId) void triggerPortalAnalysis(callLogId);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const params: Record<string, unknown> = {};
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

  const inbound = extractInboundSms(params);
  if (!inbound) {
    console.log("[wisecall-sms-inbound] non-message request", req.method, JSON.stringify(params).slice(0, 200));
    return ok();
  }

  const task = handleInbound(params).catch((e) => {
    console.error("[wisecall-sms-inbound] error:", (e as Error).message);
  });

  if (canWaitUntil()) {
    waitUntil(task);
    return ok();
  }

  await task;
  return ok();
});
