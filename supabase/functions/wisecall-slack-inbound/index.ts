// wisecall-slack-inbound — Slack messaging channel for WiseCall agents.
//
// Handles Slack Events API (url_verification + event_callback). Responds to:
//   - Direct messages to the bot (message.im)
//   - @mentions in channels (app_mention)
//
// Auth: Slack signing secret (SLACK_SIGNING_SECRET). Configure the Slack app's
// Event Subscriptions Request URL to this function's public endpoint.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SLACK_SIGNING_SECRET,
//          CLAUDE_API_WISECASE (or ANTHROPIC key via same env name as email)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CLAUDE_MODEL = "claude-opus-4-8";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-slack-request-timestamp, x-slack-signature",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

async function verifySlackSignature(req: Request, body: string, signingSecret: string): Promise<boolean> {
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const slackSignature = req.headers.get("x-slack-signature") || "";
  if (!timestamp || !slackSignature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number.parseInt(timestamp, 10)) > 60 * 5) return false;

  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBasestring));
  const hex = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const computed = `v0=${hex}`;

  if (computed.length !== slackSignature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ slackSignature.charCodeAt(i);
  }
  return mismatch === 0;
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
      max_tokens: 800,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const block = (data.content || []).find((b: { type?: string }) => b.type === "text");
  return (block?.text || "").trim();
}

async function slackApi(token: string, method: string, payload: Record<string, unknown>) {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Slack ${method}: ${data.error || "unknown"}`);
  }
  return data;
}

async function fetchSlackUser(token: string, userId: string) {
  try {
    const data = await slackApi(token, "users.info", { user: userId });
    const profile = data.user?.profile || {};
    return {
      name: profile.real_name || profile.display_name || data.user?.name || userId,
      email: (profile.email as string | undefined)?.toLowerCase() || "",
    };
  } catch (e) {
    console.error("[wisecall-slack-inbound] users.info:", (e as Error).message);
    return { name: userId, email: "" };
  }
}

function buildSlackPrompt(profile: Record<string, unknown>, contact: Record<string, unknown> | null) {
  const businessName =
    (profile.business_name as string) ||
    (profile.clinic_name as string) ||
    (profile.profile_name as string) ||
    "the business";

  const memoryLines: string[] = [];
  if (contact) {
    memoryLines.push("[CONTACT MEMORY — you have dealt with this person before]");
    if (contact.name) memoryLines.push(`Name: ${contact.name}`);
    memoryLines.push(`Previous calls: ${contact.call_count ?? 0}, previous emails: ${contact.email_count ?? 0}`);
    if (contact.ai_summary) memoryLines.push(`History: ${contact.ai_summary}`);
    if (contact.notes) memoryLines.push(`Notes: ${contact.notes}`);
  }

  return [
    (profile.system_prompt as string) ||
      `You are a helpful, professional UK English receptionist for ${businessName}.`,
    "",
    "*** SLACK CHANNEL ***",
    "You are replying in Slack — keep messages concise and conversational.",
    "- Use UK English. Be warm, practical, and professional.",
    "- Keep replies short (1–3 paragraphs max). Slack is not email.",
    "- Do not invent availability, prices, or confirmations you cannot verify.",
    "- If you need information only a human can provide, say you'll pass it to the team.",
    "- Never mention that you are an AI unless asked directly.",
    profile.business_context ? `\nBusiness knowledge:\n${profile.business_context}` : "",
    memoryLines.length ? `\n${memoryLines.join("\n")}` : "",
    "\nReturn ONLY the message text — no subject line, no markdown headers.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleSlackEvent(
  supabase: ReturnType<typeof createClient>,
  connection: Record<string, unknown>,
  event: Record<string, unknown>,
) {
  const botToken = connection.bot_token as string;
  const botUserId = connection.bot_user_id as string | undefined;
  const profileId = connection.profile_id as string;
  const teamId = connection.workspace_id as string;

  const eventType = event.type as string;
  const userId = event.user as string | undefined;
  const text = String(event.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
  const channel = event.channel as string;
  const threadTs = (event.thread_ts as string) || (event.ts as string);

  if (!userId || !text || !channel) return;
  if (userId === botUserId) return;
  if (event.bot_id || event.subtype === "bot_message") return;

  const { data: profile, error: profileError } = await supabase
    .from("wisecall_profiles")
    .select(
      "id, profile_name, business_name, clinic_name, system_prompt, business_context, greeting, timezone, is_active, metadata, after_hours_message",
    )
    .eq("id", profileId)
    .maybeSingle();

  if (profileError || !profile || !profile.is_active) {
    console.error("[wisecall-slack-inbound] profile load:", profileError?.message || "inactive");
    return;
  }

  const slackUser = await fetchSlackUser(botToken, userId);
  const businessName = profile.business_name || profile.clinic_name || profile.profile_name || "the business";

  let contactQuery = supabase
    .from("wisecall_contacts")
    .select("id, name, call_count, email_count, last_seen, ai_summary, notes, email")
    .eq("profile_id", profile.id);

  const { data: contactByEmail } = slackUser.email
    ? await contactQuery.eq("email", slackUser.email).maybeSingle()
    : { data: null };

  let contact = contactByEmail;
  if (!contact) {
    const { data: contactByMeta } = await supabase
      .from("wisecall_contacts")
      .select("id, name, call_count, email_count, last_seen, ai_summary, notes, email")
      .eq("profile_id", profile.id)
      .eq("metadata->>slack_user_id", userId)
      .maybeSingle();
    contact = contactByMeta;
  }

  const systemPrompt = buildSlackPrompt(profile, contact);
  const userMessage = `${slackUser.name} (${eventType === "app_mention" ? "mentioned you in a channel" : "sent a DM"}):\n\n${text}`;

  let replyText: string;
  try {
    replyText = await callClaude(systemPrompt, userMessage);
  } catch (e) {
    console.error("[wisecall-slack-inbound] LLM error:", (e as Error).message);
    replyText = `Thanks for your message — we've received it and the ${businessName} team will follow up shortly.`;
  }

  if (!replyText) {
    replyText = `Thanks — the ${businessName} team will be in touch shortly.`;
  }

  await slackApi(botToken, "chat.postMessage", {
    channel,
    text: replyText,
    thread_ts: threadTs,
  });

  const now = new Date().toISOString();
  let contactId = contact?.id ?? null;

  try {
    if (contact) {
      const patch: Record<string, unknown> = {
        last_seen: now,
        updated_at: now,
      };
      if (slackUser.name && !contact.name) patch.name = slackUser.name;
      if (slackUser.email && !contact.email) patch.email = slackUser.email;
      await supabase.from("wisecall_contacts").update(patch).eq("id", contact.id);
    } else {
      const { data: created } = await supabase
        .from("wisecall_contacts")
        .insert({
          profile_id: profile.id,
          email: slackUser.email || null,
          name: slackUser.name || null,
          first_seen: now,
          last_seen: now,
          metadata: { slack_user_id: userId, slack_team_id: teamId },
        })
        .select("id")
        .single();
      contactId = created?.id ?? null;
    }
  } catch (e) {
    console.error("[wisecall-slack-inbound] contact upsert:", (e as Error).message);
  }

  const eventId = event.client_msg_id || event.event_ts || crypto.randomUUID();
  try {
    await supabase.from("wisecall_call_logs").insert({
      call_id: `slack-${teamId}-${eventId}`,
      profile_id: profile.id,
      profile_name: profile.profile_name || businessName,
      caller_id: slackUser.email || slackUser.name || userId,
      contact_id: contactId,
      summary: `Slack: ${text.slice(0, 120)}${text.length > 120 ? "…" : ""}`,
      outcome: "Slack replied",
      transcript: `FROM: ${slackUser.name}${slackUser.email ? ` <${slackUser.email}>` : ""}\n\n--- Their message ---\n${text}\n\n--- WiseCall reply ---\n${replyText}`,
      started_at: now,
      finished_at: now,
      metadata: {
        channel: "slack",
        slack_team_id: teamId,
        slack_user_id: userId,
        slack_channel: channel,
        event_type: eventType,
      },
    });
  } catch (e) {
    console.error("[wisecall-slack-inbound] log insert:", (e as Error).message);
  }
}

async function processEventCallback(payload: Record<string, unknown>) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const event = (payload.event || {}) as Record<string, unknown>;
  const eventId = (payload.event_id as string) || "";
  const teamId = (payload.team_id as string) || (event.team as string) || "";

  if (!teamId || !eventId) return;

  const eventType = event.type as string;
  if (eventType !== "app_mention" && eventType !== "message") return;
  if (eventType === "message" && event.channel_type !== "im") return;

  const { error: dupErr } = await supabase.from("wisecall_slack_processed").insert({ event_id: eventId });
  if (dupErr) {
    if (dupErr.code === "23505") return;
    console.error("[wisecall-slack-inbound] dedup insert:", dupErr.message);
  }

  const { data: connection, error: connError } = await supabase
    .from("wisecall_messaging_connections")
    .select("*")
    .eq("workspace_id", teamId)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();

  if (connError || !connection) {
    console.error("[wisecall-slack-inbound] no connection for team:", teamId, connError?.message);
    return;
  }

  if (eventType === "app_mention") {
    await handleSlackEvent(supabase, connection, event);
    return;
  }

  // message.im — only direct messages to the bot
  await handleSlackEvent(supabase, connection, event);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET") || "";
  const rawBody = await req.text();

  if (signingSecret) {
    const valid = await verifySlackSignature(req, rawBody, signingSecret);
    if (!valid) return json({ error: "Invalid signature" }, 401);
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (payload.type === "url_verification") {
    return json({ challenge: payload.challenge });
  }

  if (payload.type === "event_callback") {
    // Acknowledge immediately — Slack retries after ~3s.
    const task = processEventCallback(payload).catch((e) => {
      console.error("[wisecall-slack-inbound] event processing failed:", (e as Error).message);
    });

    // @ts-ignore Supabase edge runtime
    if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
      // @ts-ignore
      EdgeRuntime.waitUntil(task);
    } else {
      await task;
    }

    return new Response("", { status: 200 });
  }

  return json({ ok: true });
});
