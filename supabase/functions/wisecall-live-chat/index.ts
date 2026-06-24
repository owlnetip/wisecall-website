import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ChatRequest = {
  session_id?: string;
  profile_slug?: string;
  message?: string;
  source?: "website" | "portal" | "api";
  page_url?: string;
  page_title?: string;
  visitor_name?: string;
  visitor_email?: string;
  visitor_phone?: string;
  metadata?: Record<string, unknown>;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normaliseText(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }

  return out;
}

function notificationRecipients(metadata: Record<string, unknown>): string[] {
  const configured = uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
  ]);

  if (configured.length > 0) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== null && entry !== ""),
  ) as Partial<T>;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isPlausibleContactName(value: string): boolean {
  const name = normaliseText(value).replace(/[.,;:!?]+$/g, "");
  const lower = name.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean);

  if (name.length < 2 || name.length > 80) return false;
  if (/[0-9@:/\\]/.test(name)) return false;
  if (words.length > 4) return false;

  if (
    /^(a|an|the|new|trying|looking|calling|want|wants|need|needs|going|gonna|report|reporting|asking|interested|just)\b/.test(
      lower,
    )
  ) {
    return false;
  }

  if (
    /\b(viewing|property|repair|maintenance|leak|callback|applicant|tenant|landlord|question|issue|help|information|details|service|services|management)\b/.test(
      lower,
    )
  ) {
    return false;
  }

  return true;
}

function extractContactData(text: string) {
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(?:\+44|0)\s?[\d\s().-]{9,}/)?.[0]?.replace(/[^\d+]/g, "");
  const name = text.match(/\b(?:my name is|this is|i am|i'm)\s+([a-z][a-z' -]{1,60})/i)?.[1]
    ?.replace(/[.,;:!?]+$/g, "")
    .trim();

  return compactObject({
    contact_email: email,
    contact_phone: phone,
    contact_name: name && isPlausibleContactName(name) ? name : undefined,
  });
}

function formatTranscript(messages: ChatMessage[]) {
  return messages
    .map((message) => `${message.role === "assistant" ? "WiseCall" : "Visitor"}: ${message.content}`)
    .join("\n");
}

function parseTranscript(transcript: string): ChatMessage[] {
  return String(transcript || "")
    .split(/\n+/)
    .map((line) => {
      const match = line.match(/^(WiseCall|Visitor):\s*(.+)$/i);
      if (!match) return null;
      return {
        role: match[1].toLowerCase() === "wisecall" ? "assistant" : "user",
        content: match[2],
      } as ChatMessage;
    })
    .filter(Boolean) as ChatMessage[];
}

function isTrivialVisitorMessage(value: string): boolean {
  const text = normaliseText(value).toLowerCase();
  if (!text) return true;
  return /^(hi|hello|hiya|hey|yes|yeah|yep|no|nope|ok|okay|thanks|thank you|test|testing)$/.test(text);
}

function hasMeaningfulVisitorMessage(transcript: string): boolean {
  return parseTranscript(transcript).some((message) => {
    if (message.role !== "user" || isTrivialVisitorMessage(message.content)) return false;
    return normaliseText(message.content).split(/\s+/).filter(Boolean).length >= 3;
  });
}

function leadEmailReason(metadata: Record<string, unknown>, collected: any, transcript: string) {
  if (collected.contact_email || collected.contact_phone) return "contact_details";
  if (metadata.live_chat_notify_without_contact === false) return null;
  if (hasMeaningfulVisitorMessage(transcript)) return "meaningful_no_contact_chat";
  return null;
}

function buildProfilePrompt(profile: any, metadata: Record<string, unknown>) {
  const receptionistName = profile?.receptionist_name || "WiseCall";
  const businessName = profile?.business_name || profile?.profile_name || "the business";
  const greeting = metadata.chat_greeting || `Hi, I am ${receptionistName}. How can I help today?`;
  const smsLinks =
    metadata.sms_links && typeof metadata.sms_links === "object"
      ? (metadata.sms_links as Record<string, string>)
      : {};
  const qualificationQuestions = Array.isArray(metadata.qualification_questions)
    ? metadata.qualification_questions.map((item) => `- ${item}`).join("\n")
    : "";

  const sections = [
    `You are ${receptionistName}, a professional UK English website live chat assistant for ${businessName}.`,
    "",
    "Core behaviour:",
    "- Reply as a live website chat assistant, not as a phone caller.",
    "- Keep replies short, practical, and natural.",
    "- Ask one clear question at a time.",
    "- Never say the visitor is calling, never offer SMS, and never say you will text them. This is website chat.",
    "- Do not invent bookings, viewing availability, fees, guarantees, opening hours, or legal advice.",
    "",
    "Using knowledge:",
    "- ALWAYS attempt to answer or troubleshoot first. Do NOT jump straight to 'I'll pass this to the team' as your first response.",
    "- If a [KNOWLEDGE BASE] block is provided below, use it as the authoritative source and answer from it.",
    "- If the question is not covered by the KB, use general knowledge to help — suggest troubleshooting steps, explain the issue, offer practical guidance.",
    "- Only escalate to the support team when: (a) the problem needs account-specific access or system configuration you cannot see, OR (b) the visitor explicitly asks to speak to someone or raise a ticket, OR (c) you have genuinely tried to help and the issue remains unresolved.",
    "- When you do escalate, capture the visitor's name, best phone or email, and a clear description of the unresolved issue.",
    "- Never invent business-specific details (prices, timescales, account config, contract terms) — for those, say you will check with the support team.",
    "- Use UK English.",
    "",
    `Opening greeting reference: ${greeting}`,
  ];

  if (profile?.business_context) {
    sections.push("", "Business context:", String(profile.business_context).trim());
  }

  if (profile?.system_prompt) {
    sections.push("", "Client operating instructions:", String(profile.system_prompt).trim());
  }

  if (qualificationQuestions) {
    sections.push(
      "",
      "If the visitor is a new lettings applicant, qualify them with these questions one at a time:",
      qualificationQuestions,
    );
  }

  if (smsLinks.repair || metadata.repair_route) {
    const repairLink =
      smsLinks.repair ||
      (metadata.repair_route && typeof metadata.repair_route === "object"
        ? String((metadata.repair_route as Record<string, unknown>).sms_link || "")
        : "");
    sections.push(
      "",
      "For repair, leak, or maintenance enquiries:",
      `- Always give this direct report link in chat: ${repairLink || "the client's repair reporting page"}.`,
      "- Do not replace the direct link with a menu instruction unless you are also giving the direct link.",
      "- Ask whether there are urgent safety concerns or vulnerable residents.",
      "- Offer to pass the details to the team if they still need help.",
    );
  }

  if (profile?.escalation_message) {
    sections.push("", `Escalation wording: ${String(profile.escalation_message).trim()}`);
  }

  sections.push(
    "",
    "Website chat override:",
    "- If any client operating instruction conflicts with website chat, adapt it to website chat.",
    "- Replace phone words like caller, calling, call, and SMS with visitor, chat, callback, email, or direct link as appropriate.",
  );

  sections.push("", `Business name reference: ${businessName}.`);
  return sections.join("\n").trim();
}

async function loadProfile(supabase: any, slug: string) {
  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select(
      "id,slug,profile_name,business_name,receptionist_name,greeting,system_prompt,business_context,escalation_message,metadata,is_active",
    )
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}

// Only inject KB chunks this relevant. Below this, the match is noise (e.g. an
// unrelated billing chunk surfacing for a voicemail question) and would mislead
// the agent more than help, so we fall back to general knowledge instead.
const KB_MIN_SIMILARITY = 0.35;

// Pull relevant knowledge-base context for the visitor's question by calling the
// wisecall-kb-search function (which embeds with Jina and runs the match RPC,
// scoped to this agent's profile id). Relevance-gated: returns a context block
// built only from sufficiently-similar chunks, or null when nothing is a good
// match. Never throws — KB lookup is best-effort and must not break the chat.
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
    console.error("[wisecall-live-chat] kb context:", (e as Error).message);
    return null;
  }
}

async function callOpenAi(profile: any, history: ChatMessage[], kbContext: string | null) {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const prompt = buildProfilePrompt(profile, profile?.metadata || {});
  const messages = [
    { role: "system", content: prompt },
    ...(kbContext ? [{ role: "system", content: kbContext }] : []),
    ...history.slice(-18).map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    })),
  ];

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: Deno.env.get("WISECALL_CHAT_MODEL") || "gpt-4.1-mini",
      messages,
      temperature: 0.25,
      max_tokens: 450,
    }),
  });

  if (!response.ok) {
    console.error("WiseCall live chat OpenAI error:", response.status, await response.text());
    return null;
  }

  const result = await response.json();
  return normaliseText(result?.choices?.[0]?.message?.content);
}

function fallbackReply(profile: any, collected: Record<string, unknown>) {
  const name = profile?.receptionist_name || "WiseCall";

  if (collected.contact_email || collected.contact_phone) {
    return "Thanks, I have captured that and will pass it to the team for follow-up.";
  }

  return `Thanks, ${name} can help with that. Please send your name, the best email or phone number, and a short note on what you need.`;
}

function buildLeadEmailHtml(profile: any, chatLog: any, collected: any, transcript: string) {
  const businessName = profile?.business_name || profile?.profile_name || "WiseCall client";
  const pageUrl = chatLog?.metadata?.page_url || "";

  return `
    <div style="margin:0;padding:24px;background:#172929;color:#ffffff;font-family:Arial,sans-serif;">
      <div style="max-width:720px;margin:0 auto;">
        <h1 style="margin:0 0 8px;color:#7de8eb;font-size:26px;">WiseCall live chat</h1>
        <p style="margin:0 0 22px;color:#d8eeee;">New website chat enquiry for ${escapeHtml(businessName)}.</p>
        <table style="width:100%;border-collapse:collapse;margin:0 0 22px;">
          <tr><td style="padding:8px 0;color:#7de8eb;font-weight:bold;">Name</td><td style="padding:8px 0;">${escapeHtml(collected.contact_name || "Unknown")}</td></tr>
          <tr><td style="padding:8px 0;color:#7de8eb;font-weight:bold;">Email</td><td style="padding:8px 0;">${escapeHtml(collected.contact_email || "Not provided")}</td></tr>
          <tr><td style="padding:8px 0;color:#7de8eb;font-weight:bold;">Phone</td><td style="padding:8px 0;">${escapeHtml(collected.contact_phone || "Not provided")}</td></tr>
          <tr><td style="padding:8px 0;color:#7de8eb;font-weight:bold;">Page</td><td style="padding:8px 0;">${pageUrl ? `<a href="${escapeHtml(pageUrl)}" style="color:#7de8eb;">${escapeHtml(pageUrl)}</a>` : "Unknown"}</td></tr>
        </table>
        <h2 style="margin:0 0 10px;color:#7de8eb;font-size:20px;">Transcript</h2>
        <pre style="white-space:pre-wrap;background:#0f2020;border:1px solid rgba(125,232,235,.35);border-radius:8px;padding:16px;color:#ffffff;font-family:Arial,sans-serif;line-height:1.45;">${escapeHtml(transcript)}</pre>
      </div>
    </div>
  `;
}

async function maybeSendLeadEmail(supabase: any, profile: any, chatLog: any, collected: any, transcript: string) {
  const metadata = profile?.metadata || {};
  const reason = leadEmailReason(metadata, collected, transcript);
  if (!reason || chatLog?.metadata?.lead_email_sent) return false;

  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  if (!resendApiKey) return false;

  const recipients = notificationRecipients(metadata);
  const bcc = asEmailList(metadata.bcc_emails);
  const from = Deno.env.get("WISECALL_EMAIL_FROM") || "WiseCall <info@owlnet.io>";

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: recipients,
      bcc: bcc.length > 0 ? bcc : undefined,
      reply_to: metadata.reply_to_email || undefined,
      subject: `WiseCall live chat - ${profile?.business_name || profile?.profile_name || "Client"} enquiry`,
      html: buildLeadEmailHtml(profile, chatLog, collected, transcript),
    }),
  });

  if (!response.ok) {
    console.error("WiseCall live chat email failed:", response.status, await response.text());
    return false;
  }

  await supabase
    .from("wisecall_call_logs")
    .update({
      metadata: {
        ...(chatLog.metadata || {}),
        collected,
        lead_email_sent: true,
        lead_email_sent_at: new Date().toISOString(),
        lead_email_reason: reason,
      },
    })
    .eq("call_id", chatLog.call_id);

  return true;
}

async function getOrCreateChatLog(supabase: any, profile: any, body: ChatRequest, collected: Record<string, unknown>) {
  if (body.session_id) {
    const { data, error } = await supabase
      .from("wisecall_call_logs")
      .select("*")
      .eq("call_id", body.session_id)
      .maybeSingle();

    if (error) throw new Error(error.message || JSON.stringify(error));
    if (data) return data;
  }

  const callId = `chat_${crypto.randomUUID()}`;
  const metadata = {
    source: "wisecall-live-chat",
    profile_slug: profile.slug,
    profile_id: profile.id,
    page_url: body.page_url,
    page_title: body.page_title,
    visitor_metadata: body.metadata || {},
    collected,
  };

  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .insert({
      call_id: callId,
      profile_id: profile.id,
      profile_name: profile.profile_name || profile.business_name,
      caller_id: collected.contact_email || collected.contact_phone || "website visitor",
      summary: "Website live chat started",
      outcome: "live_chat_in_progress",
      transcript: "",
      session_state: "live_chat",
      started_at: new Date().toISOString(),
      metadata,
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message || JSON.stringify(error));
  return data;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Supabase environment is not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const profileSlug = url.searchParams.get("profile_slug") || "the-home-cloud";
      const profile = await loadProfile(supabase, profileSlug);
      if (!profile) return jsonResponse({ error: "Profile not found" }, 404);

      return jsonResponse({
        profile_slug: profile.slug,
        title: profile.business_name || profile.profile_name || "WiseCall",
        assistant_name: profile.receptionist_name || "WiseCall",
        greeting:
          profile.metadata?.chat_greeting ||
          `Hi, I am ${profile.receptionist_name || "WiseCall"}. How can I help today?`,
        accent_color: profile.metadata?.chat_accent_color || "#7de8eb",
        background_color: profile.metadata?.chat_background_color || "#172929",
      });
    }

    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const body = (await req.json()) as ChatRequest;
    const message = normaliseText(body.message);
    const profileSlug = normaliseText(body.profile_slug || "the-home-cloud");
    if (!message) return jsonResponse({ error: "message is required" }, 400);

    const profile = await loadProfile(supabase, profileSlug);
    if (!profile) return jsonResponse({ error: "Profile not found" }, 404);

    const extracted = {
      ...(body.session_id ? {} : {}),
      ...extractContactData(message),
      ...compactObject({
        contact_name: body.visitor_name,
        contact_email: body.visitor_email,
        contact_phone: body.visitor_phone,
      }),
    };

    let chatLog = await getOrCreateChatLog(supabase, profile, body, extracted);
    const collected = { ...(chatLog.metadata?.collected || {}), ...extracted };
    const history = [...parseTranscript(chatLog.transcript || ""), { role: "user", content: message } as ChatMessage];
    // Build a richer KB search query from the last few user messages so the KB
    // can match based on full conversation context, not just the single latest
    // message (which is often vague without the prior turns).
    const recentUserTurns = history
      .filter((m) => m.role === "user")
      .slice(-3)
      .map((m) => m.content)
      .join(" ");
    const kbContext = await fetchKbContext(profile.id, recentUserTurns || message);
    const reply = (await callOpenAi(profile, history, kbContext)) || fallbackReply(profile, collected);
    const updatedMessages = [...history, { role: "assistant", content: reply } as ChatMessage];
    const transcript = formatTranscript(updatedMessages);

    const summarySource = message.length > 180 ? `${message.slice(0, 177)}...` : message;
    const updatePayload = {
      caller_id: collected.contact_email || collected.contact_phone || chatLog.caller_id || "website visitor",
      summary: summarySource || "Website live chat",
      outcome: "live_chat",
      transcript,
      finished_at: new Date().toISOString(),
      metadata: {
        ...(chatLog.metadata || {}),
        collected,
        last_page_url: body.page_url || chatLog.metadata?.page_url,
        last_message_at: new Date().toISOString(),
      },
    };

    const { data: updatedLog, error: updateError } = await supabase
      .from("wisecall_call_logs")
      .update(updatePayload)
      .eq("call_id", chatLog.call_id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message || JSON.stringify(updateError));
    chatLog = updatedLog;

    const emailSent = await maybeSendLeadEmail(supabase, profile, chatLog, collected, transcript);

    return jsonResponse({
      session_id: chatLog.call_id,
      reply,
      enquiry: emailSent ? { email_sent: true } : null,
      status: "live_chat",
    });
  } catch (error) {
    console.error("wisecall-live-chat error:", error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
