// wisecall-email-inbound, the email channel for WiseCall agents.
//
// Flow: a customer forwards their inbound mail to {slug}-{shortid}@in.wisecall.io.
// Resend Inbound parses the email and POSTs it here. We resolve the agent, reply
// with the same "brain" the phone agent uses (the agent's system_prompt + caller
// memory), send the reply via Resend (threaded), and log it to the Contacts view
//, one source of truth across phone + email.
//
// Auth: Resend webhook URL must include ?secret=<WISECALL_EMAIL_INBOUND_SECRET>.
//
// ⚠️ RESEND QUIRKS, read before editing (these cost real debugging time):
//
//   1. The email.received webhook is METADATA ONLY (to/from/subject/email_id/
//      message_id). It does NOT include the body, html, headers or attachments.
//      You MUST fetch them separately:  GET https://api.resend.com/emails/
//      receiving/{email_id}  → response has { text, html, headers }.
//      (Resend docs index lives at resend.com/docs/llms.txt; the human URLs 404.)
//
//   2. That retrieval needs a READ-CAPABLE Resend key. The shared RESEND_API_KEY
//      is restricted to SENDING and returns 401 "This API key is restricted to
//      only send emails". Use a Full-access key, here the `wisecal_api_key`
//      secret. Read-key precedence: RESEND_INBOUND_API_KEY || wisecal_api_key ||
//      RESEND_API_KEY. Do NOT "simplify" this back to RESEND_API_KEY.
//
//   3. The webhook is delivered AT-LEAST-ONCE and retries when this handler is
//      slow, so it WILL fire twice and the agent replied twice. We dedupe on
//      email_id via wisecall_email_processed (claimed atomically before any send).
//
// Secrets used (already configured in this project):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   wisecal_api_key  (Full-access Resend key, used to READ inbound bodies)
//   RESEND_API_KEY   (send-only, used for the outbound reply)
//   CLAUDE_API_WISECASE                  (Anthropic key)
//   WISECALL_EMAIL_INBOUND_SECRET        (shared secret in the webhook URL)
//   WISECALL_EMAIL_INBOUND_DOMAIN        (optional; default "in.wisecall.io")

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildMemoryBlock, loadContactContext, triggerPortalAnalysis } from "../_shared/contact-memory.ts";

const INBOUND_DOMAIN = Deno.env.get("WISECALL_EMAIL_INBOUND_DOMAIN") || "in.wisecall.io";
const CLAUDE_MODEL = "claude-opus-4-8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function slugify(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function shortId(uuid: string): string {
  return (uuid || "").replace(/-/g, "").slice(0, 8);
}

// The address a customer forwards to. Readable + uniquely resolvable.
function agentEmailAddress(profile: { id: string; business_name?: string; clinic_name?: string; profile_name?: string }): string {
  const name = profile.business_name || profile.clinic_name || profile.profile_name || "agent";
  const slug = slugify(name) || "agent";
  return `${slug}-${shortId(profile.id)}@${INBOUND_DOMAIN}`;
}

// Pull a plain email out of "Name <email>" or a raw address.
function parseAddress(raw: string): { email: string; name: string } {
  if (!raw) return { email: "", name: "" };
  const m = raw.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: raw.trim().toLowerCase() };
}

// Resend inbound payloads vary; pull fields defensively from data or top level.
function extractEmail(payload: any) {
  const d = payload?.data ?? payload ?? {};
  const headers = d.headers ?? d.email?.headers ?? {};
  const hget = (k: string) => {
    if (Array.isArray(headers)) {
      const h = headers.find((x: any) => String(x?.name || "").toLowerCase() === k.toLowerCase());
      return h?.value || "";
    }
    return headers?.[k] || headers?.[k.toLowerCase()] || "";
  };

  const toRaw = d.to ?? d.recipient ?? d.email?.to ?? [];
  const toList: string[] = Array.isArray(toRaw)
    ? toRaw.map((x: any) => (typeof x === "string" ? x : x?.email || x?.address || ""))
    : [String(toRaw)];

  const fromRaw =
    (typeof d.from === "string" ? d.from : d.from?.email || d.from?.address) ||
    d.sender ||
    d.email?.from ||
    "";

  return {
    to: toList.map((s) => parseAddress(String(s)).email).filter(Boolean),
    from: parseAddress(String(fromRaw)),
    subject: d.subject || d.email?.subject || "(no subject)",
    text: d.text || d.plain || d.email?.text || "",
    html: d.html || d.email?.html || "",
    messageId: d.message_id || d.messageId || hget("Message-ID") || hget("Message-Id") || "",
    references: d.references || hget("References") || "",
    inReplyTo: d.in_reply_to || hget("In-Reply-To") || "",
  };
}

// Strip the quoted reply chain (Gmail/Outlook) so the agent only reads the new
// message. Conservative: if stripping would leave nothing, keep the original.
function stripQuotedReply(body: string): string {
  if (!body) return body;
  let text = body;

  // Gmail attribution can wrap across lines ("On <date> <name> <\nemail> wrote:")
  // so match with the `s` flag (dot spans newlines), non-greedy up to "wrote:".
  const gmail = text.search(/\n\s*On\s[\s\S]{0,200}?\bwrote:/i);
  if (gmail !== -1) text = text.slice(0, gmail);

  // Line-anchored markers for Outlook / forwards / signatures. A sign-off line
  // ("Kind regards,") is included because everything after it is reliably the
  // signature block + any legal disclaimer, and both of those pollute the
  // knowledge-base search query if left in (a corporate footer's own place
  // names / boilerplate outweigh the actual one-line question).
  const lines = text.split(/\r?\n/);
  const cutMarkers = [
    /^-{2,}\s*Original Message\s*-{2,}/i,
    /^_{5,}/,
    /^From:\s.+/i,
    /^Sent from my /i,
    /^(kind\s+regards|best\s+regards|warm\s+regards|kindest\s+regards|many\s+thanks|thanks\s+again|thank\s+you|regards|cheers|best\s+wishes|yours\s+sincerely|yours\s+faithfully|best)\s*,?\s*$/i,
  ];
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (cutMarkers.some((re) => re.test(lines[i].trim()))) {
      cut = i;
      break;
    }
  }
  let kept = lines.slice(0, cut);
  // Drop any trailing quoted (">") lines and trailing blanks.
  while (kept.length && (kept[kept.length - 1].trim().startsWith(">") || kept[kept.length - 1].trim() === "")) {
    kept.pop();
  }
  const result = kept.join("\n").trim();
  return result || body.trim();
}

function normalizeSubject(subject: string): string {
  return String(subject || "")
    .replace(/^email:\s*/i, "")
    .replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function normalizeMessageId(value: string): string {
  return String(value || "")
    .trim()
    .replace(/^<|>$/g, "")
    .toLowerCase();
}

function parseMessageIds(value: string): string[] {
  const raw = String(value || "");
  const angle = raw.match(/<[^>]+>/g)?.map((id) => normalizeMessageId(id)) || [];
  if (angle.length) return [...new Set(angle.filter(Boolean))];
  return [...new Set(raw.split(/\s+/).map(normalizeMessageId).filter(Boolean))];
}

function firstUsefulEmailLine(text: string): string {
  const lines = String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (
      /^(hi|hello|dear|thanks|thank you|kind regards|regards|cheers|sent from|best)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    if (/^(from|to|subject|date):/i.test(line)) continue;
    if (line.includes("@") && line.length < 80) continue;
    if (line.length < 12) continue;
    return line.replace(/\s+/g, " ").trim();
  }
  return "";
}

function buildEmailSummary(opts: {
  fromName?: string;
  subject: string;
  incoming: string;
  replyText: string;
  priorSummary?: string | null;
}): string {
  const ask =
    firstUsefulEmailLine(opts.incoming) ||
    normalizeSubject(opts.subject).replace(/\b\w/g, (c) => c.toUpperCase()) ||
    "an enquiry";
  const shortAsk = ask.length > 110 ? `${ask.slice(0, 107).trim()}...` : ask;
  const firstName = String(opts.fromName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)[0];
  const who = firstName ? `${firstName} emailed` : "Customer emailed";
  const prices = opts.replyText.match(/£\s*[\d.]+/g)?.slice(0, 4) || [];
  const priceNote = prices.length ? ` Quoted ${prices.join(", ")}.` : "";

  if (opts.priorSummary && !/^email:\s*/i.test(opts.priorSummary)) {
    const follow = firstUsefulEmailLine(opts.incoming);
    if (follow) {
      const shortFollow = follow.length > 90 ? `${follow.slice(0, 87).trim()}...` : follow;
      return `${who} a follow-up: ${shortFollow}.${priceNote}`.trim();
    }
  }

  return `${who} about ${shortAsk}.${priceNote}`.trim();
}

function formatExchangeBlock(opts: {
  fromEmail: string;
  subject: string;
  incoming: string;
  replyText: string;
  at?: string;
}): string {
  const when = new Date(opts.at || Date.now()).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  return [
    `--- Exchange · ${when} ---`,
    `FROM: ${opts.fromEmail}`,
    `SUBJECT: ${opts.subject}`,
    "",
    "--- Their message ---",
    opts.incoming,
    "",
    "--- WiseCall reply ---",
    opts.replyText,
  ].join("\n");
}

type EmailThreadRow = {
  id: string;
  call_id: string;
  transcript: string | null;
  summary: string | null;
  metadata: Record<string, unknown> | null;
  started_at: string;
};

async function findEmailThread(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  fromEmail: string,
  email: { subject: string; messageId: string; inReplyTo: string; references: string },
): Promise<EmailThreadRow | null> {
  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select("id, call_id, transcript, summary, metadata, started_at")
    .eq("profile_id", profileId)
    .eq("caller_id", fromEmail)
    .order("started_at", { ascending: false })
    .limit(30);

  if (error || !data?.length) return null;

  const emailRows = (data as EmailThreadRow[]).filter((row) => {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    return String(meta.channel || "").toLowerCase() === "email";
  });
  if (!emailRows.length) return null;

  const relatedIds = new Set(
    [
      ...parseMessageIds(email.inReplyTo),
      ...parseMessageIds(email.references),
      normalizeMessageId(email.messageId),
    ].filter(Boolean),
  );

  for (const row of emailRows) {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const known = new Set<string>();
    const pushId = (value: unknown) => {
      if (!value) return;
      if (Array.isArray(value)) {
        for (const item of value) known.add(normalizeMessageId(String(item)));
        return;
      }
      known.add(normalizeMessageId(String(value)));
    };
    pushId(meta.message_id);
    pushId(meta.last_message_id);
    pushId(meta.outbound_message_id);
    pushId(meta.message_ids);
    const selfId = normalizeMessageId(email.messageId);
    for (const id of relatedIds) {
      if (id && id !== selfId && known.has(id)) return row;
    }
  }

  const subjectKey = normalizeSubject(email.subject);
  if (!subjectKey) return null;
  const maxAgeMs = 30 * 24 * 60 * 60 * 1000;
  for (const row of emailRows) {
    const meta = (row.metadata || {}) as Record<string, unknown>;
    const rowSubject = normalizeSubject(
      String(meta.subject || meta.thread_subject || row.summary || ""),
    );
    if (!rowSubject || rowSubject !== subjectKey) continue;
    const age = Date.now() - new Date(row.started_at).getTime();
    if (age <= maxAgeMs) return row;
  }

  return null;
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
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b: any) => b.type === "text");
  return (block?.text || "").trim();
}

// Only inject KB chunks this relevant; weaker matches are noise that would
// mislead the reply more than help.
const KB_MIN_SIMILARITY = 0.35;

// Relevance-gated knowledge-base lookup for the inbound email, via the
// wisecall-kb-search function (scoped to this agent's profile id). Prefers
// verified price answers from keyword/price-line extraction when present.
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
    if (typeof data?.context === "string" && data.context.trim()) {
      return data.context.trim();
    }
    if (data?.answer) {
      return [
        "[KNOWLEDGE BASE]",
        "VERIFIED PRICE ANSWER (quote these figures in your reply; do not say prices are unavailable):",
        String(data.answer),
      ].join("\n");
    }
    const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const relevant = chunks
      .filter((c: { content?: string; similarity?: number }) =>
        c?.content && typeof c.similarity === "number" && c.similarity >= KB_MIN_SIMILARITY)
      .map((c: { content: string }) => c.content);
    if (!relevant.length) return null;
    return "[KNOWLEDGE BASE]\n" + relevant.join("\n---\n");
  } catch (e) {
    console.error("[wisecall-email-inbound] kb context:", (e as Error).message);
    return null;
  }
}

async function sendReply(opts: {
  fromAddress: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string;
}) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("RESEND_API_KEY not configured");

  const headers: Record<string, string> = {};
  if (opts.inReplyTo) {
    headers["In-Reply-To"] = opts.inReplyTo;
    headers["References"] = opts.references ? `${opts.references} ${opts.inReplyTo}` : opts.inReplyTo;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${opts.fromName} via WiseCall <${opts.fromAddress}>`,
      to: opts.to,
      reply_to: opts.fromAddress,
      subject: opts.subject,
      text: opts.text,
      headers: Object.keys(headers).length ? headers : undefined,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`);
  }
  return await res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Shared-secret auth (Resend webhook URL carries ?secret=…). Uses a dedicated
  // inbound secret so it's independent of the shared WISECALL_EMAIL_WEBHOOK_SECRET.
  const url = new URL(req.url);
  const expected =
    Deno.env.get("WISECALL_EMAIL_INBOUND_SECRET") ||
    Deno.env.get("WISECALL_EMAIL_WEBHOOK_SECRET") ||
    "";
  const provided = url.searchParams.get("secret") || req.headers.get("x-webhook-secret") || "";
  if (!expected || provided !== expected) {
    return json({ error: "Unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const email = extractEmail(payload);

  // Resend's email.received webhook only carries METADATA, the body, headers and
  // attachments must be fetched separately via the Receiving API using email_id.
  // Needs a key with read access (RESEND_INBOUND_API_KEY); the send-only key 401s.
  const emailId = payload?.data?.email_id || payload?.data?.id || "";
  if (emailId && !email.text && !email.html) {
    try {
      const readKey =
        Deno.env.get("RESEND_INBOUND_API_KEY") ||
        Deno.env.get("wisecal_api_key") ||
        Deno.env.get("RESEND_API_KEY");
      const r = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
        headers: { Authorization: `Bearer ${readKey}` },
      });
      if (r.ok) {
        const full = await r.json();
        email.text = full.text || email.text;
        email.html = full.html || email.html;
        if (!email.messageId && full.message_id) email.messageId = full.message_id;
      } else {
        console.error(`[wisecall-email-inbound] body fetch ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }
    } catch (e) {
      console.error("[wisecall-email-inbound] body fetch error:", (e as Error).message);
    }
  }
  if (!email.from.email || email.to.length === 0) {
    // Nothing actionable (e.g. a delivery/test ping), ack so Resend stops retrying.
    return json({ ok: true, skipped: "no from/to" });
  }

  // Resolve the agent from the in.wisecall.io recipient.
  const recipient = email.to.find((a) => a.endsWith(`@${INBOUND_DOMAIN}`));
  if (!recipient) return json({ ok: true, skipped: "not an inbound-domain recipient" });

  // Idempotency guard: Resend delivers email.received at-least-once and retries
  // when this handler is slow (body fetch + LLM + send = seconds), so it fires
  // twice and the agent replied twice. Claim the email_id atomically BEFORE the
  // send; a PK conflict means it's a duplicate delivery → skip. Other DB errors
  // fail-open so a transient hiccup never blocks a genuine reply.
  if (emailId) {
    const { error: dupErr } = await supabase
      .from("wisecall_email_processed")
      .insert({ email_id: emailId });
    if (dupErr) {
      if (dupErr.code === "23505") return json({ ok: true, skipped: "duplicate delivery" });
      console.error("[wisecall-email-inbound] dedup insert:", dupErr.message);
    }
  }

  const localPart = recipient.split("@")[0];
  const token = localPart.split("-").pop() || localPart; // trailing shortid

  // Pull active profiles and match on computed shortId (or stored email_address).
  const { data: profiles, error: pErr } = await supabase
    .from("wisecall_profiles")
    .select("id, profile_name, business_name, clinic_name, system_prompt, business_context, greeting, timezone, is_active, metadata, after_hours_message");

  if (pErr) return json({ error: pErr.message }, 500);

  const profile = (profiles || []).find((p: any) => {
    const stored = (p.metadata?.email_address || "").toLowerCase();
    if (stored && stored === recipient) return true;
    return shortId(p.id) === token.toLowerCase();
  });

  if (!profile) return json({ ok: true, skipped: `no agent for ${recipient}` });

  const ownerId = (profile.metadata as Record<string, string> | null)?.owner_id;
  if (!ownerId) return json({ ok: true, skipped: "no owner" });

  const { data: billingRow } = await supabase
    .from("wisecall_billing")
    .select("email_channel_enabled, email_channel_status")
    .eq("user_id", ownerId)
    .maybeSingle();

  if (!billingRow?.email_channel_enabled || billingRow.email_channel_status !== "active") {
    return json({ ok: true, skipped: "email channel not active" });
  }

  const businessName = profile.business_name || profile.clinic_name || profile.profile_name || "the business";
  const fromAddress = agentEmailAddress(profile);

  const contactContext = await loadContactContext(supabase, profile.id, {
    email: email.from.email,
  });
  const memoryBlock = buildMemoryBlock(contactContext);
  const contact = contactContext.contact;

  const rawBody = email.text || email.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const incoming = stripQuotedReply(rawBody);

  // Continue an existing inbox thread when this is a reply in the same conversation.
  const existingThread = await findEmailThread(supabase, profile.id, email.from.email, email);

  // Relevance-gated knowledge-base lookup using the email's subject + body.
  const kbContext = await fetchKbContext(
    profile.id,
    `${email.subject || ""}\n${incoming}`.trim(),
  );

  const priorThreadBlock = existingThread?.transcript
    ? `\n[PRIOR EMAIL THREAD — continue this conversation; do not restart from scratch]\n${String(existingThread.transcript).slice(-3500)}`
    : "";

  const systemPrompt = [
    profile.system_prompt || `You are a helpful, professional UK English receptionist for ${businessName}.`,
    "",
    "*** EMAIL CHANNEL ***",
    "You are now replying to a customer by EMAIL, not on a phone call. Adjust accordingly:",
    "- Write a clear, well-structured written reply (greeting, body, sign-off).",
    "- Use UK English. Be warm, concise and professional.",
    `- Sign off as the ${businessName} team.`,
    "- Do not invent availability, prices, or confirmations you cannot verify.",
    "- If a [KNOWLEDGE BASE] block includes a VERIFIED PRICE ANSWER or Direct price matches, quote those £ figures clearly in the reply. Do not say prices must be confirmed by the team when those figures are present.",
    "- If you need information only a human or a booking system can provide, and the knowledge base does not cover it, say you'll pass it to the team and they'll follow up, and capture what you can.",
    "- Never mention that you are an AI unless asked directly.",
    "",
    "Using knowledge:",
    "- If a [KNOWLEDGE BASE] block is provided below, treat it as the authoritative source and answer from it.",
    "- Prefer VERIFIED PRICE ANSWER / Direct price matches over raw excerpts when both are present.",
    "- If it does not cover the question, you may use general knowledge to help, BUT never invent business-specific details (prices, timescales, account or system specifics). For those, say the team will confirm and follow up.",
    "- If you are unsure, be honest and offer to have the team follow up rather than guessing.",
    profile.business_context ? `\nBusiness knowledge:\n${profile.business_context}` : "",
    kbContext ? `\n${kbContext}` : "",
    memoryBlock ? `\n${memoryBlock}` : "",
    priorThreadBlock,
    "\nReturn ONLY the body of the email reply, no subject line, no email headers.",
  ]
    .filter(Boolean)
    .join("\n");

  const userMessage = `The customer (${email.from.name || email.from.email}) emailed:\n\nSubject: ${email.subject}\n\n${incoming}`;

  let replyText: string;
  try {
    replyText = await callClaude(systemPrompt, userMessage);
  } catch (e) {
    console.error("[wisecall-email-inbound] LLM error:", (e as Error).message);
    return json({ error: "LLM failed" }, 502);
  }
  if (!replyText) replyText = `Thanks for your email, we've received it and the ${businessName} team will be in touch shortly.`;

  // Send the threaded reply from the agent's address.
  const replySubject = /^re:/i.test(email.subject) ? email.subject : `Re: ${email.subject}`;
  let outboundId = "";
  try {
    const sent = await sendReply({
      fromAddress,
      fromName: businessName,
      to: email.from.email,
      subject: replySubject,
      text: replyText,
      inReplyTo: email.messageId,
      references: email.references,
    });
    outboundId = String((sent as { id?: string })?.id || "");
  } catch (e) {
    console.error("[wisecall-email-inbound] send error:", (e as Error).message);
    return json({ error: "Send failed" }, 502);
  }

  try {
    await supabase.rpc("wisecall_record_email_reply", { p_owner: ownerId });
  } catch (e) {
    console.error("[wisecall-email-inbound] usage record:", (e as Error).message);
  }

  // Upsert the contact by email (one source of truth across channels).
  const now = new Date().toISOString();
  let contactId = (contact?.id as string | undefined) ?? null;
  try {
    if (contact) {
      const patch: Record<string, unknown> = {
        last_seen: now,
        updated_at: now,
        email_count: ((contact.email_count as number) || 0) + 1,
      };
      if (email.from.name && !contact.name) patch.name = email.from.name;
      await supabase.from("wisecall_contacts").update(patch).eq("id", contact.id);
    } else {
      const { data: created } = await supabase
        .from("wisecall_contacts")
        .insert({
          profile_id: profile.id,
          email: email.from.email,
          name: email.from.name || null,
          email_count: 1,
          first_seen: now,
          last_seen: now,
        })
        .select("id")
        .single();
      contactId = created?.id ?? null;
    }
  } catch (e) {
    console.error("[wisecall-email-inbound] contact upsert:", (e as Error).message);
  }

  const exchange = formatExchangeBlock({
    fromEmail: email.from.email,
    subject: email.subject,
    incoming,
    replyText,
    at: now,
  });
  const summary = buildEmailSummary({
    fromName: email.from.name,
    subject: email.subject,
    incoming,
    replyText,
    priorSummary: existingThread?.summary,
  });

  // Log the interaction to the call-logs table (channel = email), appending to
  // an existing thread when this is a follow-up in the same conversation.
  let callLogId: string | null = null;
  try {
    if (existingThread) {
      const prevMeta = (existingThread.metadata || {}) as Record<string, unknown>;
      const prevIds = Array.isArray(prevMeta.message_ids)
        ? prevMeta.message_ids.map((id) => String(id))
        : [String(prevMeta.message_id || "")].filter(Boolean);
      const messageIds = [
        ...new Set(
          [...prevIds, email.messageId, outboundId].map((id) => String(id || "").trim()).filter(Boolean),
        ),
      ];
      const transcript = [existingThread.transcript || "", exchange].filter(Boolean).join("\n\n");
      const { data: logRow } = await supabase
        .from("wisecall_call_logs")
        .update({
          summary,
          outcome: "Email replied",
          transcript,
          finished_at: now,
          contact_id: contactId || undefined,
          metadata: {
            ...prevMeta,
            channel: "email",
            subject: email.subject,
            thread_subject: normalizeSubject(email.subject),
            message_id: email.messageId || prevMeta.message_id,
            last_message_id: email.messageId,
            outbound_message_id: outboundId || prevMeta.outbound_message_id,
            message_ids: messageIds,
            exchange_count: Number(prevMeta.exchange_count || 1) + 1,
          },
        })
        .eq("id", existingThread.id)
        .select("id")
        .single();
      callLogId = logRow?.id ?? existingThread.id;
    } else {
      const { data: logRow } = await supabase.from("wisecall_call_logs").insert({
        call_id: `email-thread-${crypto.randomUUID()}`,
        profile_id: profile.id,
        profile_name: profile.profile_name || businessName,
        caller_id: email.from.email,
        contact_id: contactId,
        summary,
        outcome: "Email replied",
        transcript: exchange,
        started_at: now,
        finished_at: now,
        metadata: {
          channel: "email",
          subject: email.subject,
          thread_subject: normalizeSubject(email.subject),
          message_id: email.messageId,
          last_message_id: email.messageId,
          outbound_message_id: outboundId || null,
          message_ids: [email.messageId, outboundId].filter(Boolean),
          exchange_count: 1,
        },
      }).select("id").single();
      callLogId = logRow?.id ?? null;
    }
  } catch (e) {
    console.error("[wisecall-email-inbound] log upsert:", (e as Error).message);
  }

  if (callLogId) void triggerPortalAnalysis(callLogId);

  return json({
    ok: true,
    agent: profile.id,
    replied_to: email.from.email,
    threaded: Boolean(existingThread),
    call_log_id: callLogId,
  });
});
