"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/env";
import { raiseSupportTicket } from "@/app/actions/support";

// Sonnet, not the Opus model call-analysis.ts uses for after-call analysis —
// this is a live, high-volume chat endpoint, so the faster/cheaper model is
// the right tradeoff for a first-line support bot that has an escalation path.
const CLAUDE_MODEL = "claude-sonnet-5";

function getClaudeApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE || null;
}

// Self-serve support chat for the WiseCall portal itself: "Ava" answers from
// WiseCall's own product knowledge base first, and only files a ticket into
// the shared support desk once she genuinely can't help. This profile is a
// fixed internal agent (not customer data), so it's safe to hardcode the id
// here rather than route through the ownership-gated agent-lookup helpers
// used for customers' own agents.
const SUPPORT_AVA_PROFILE_ID = "c309f85e-b3d5-4ba3-8803-1b8702b100c0";

type ChatTurn = { role: "user" | "assistant"; content: string };

export type SupportChatResult =
  | { ok: true; reply: string; ticketNumber?: string }
  | { ok: false; error: string };

const ESCALATE_PATTERN = /<<<ESCALATE:\s*([\s\S]+?)>>>\s*$/;

async function searchSupportKb(query: string): Promise<string | null> {
  try {
    const config = getSupabaseConfig();
    if (!config) return null;

    const res = await fetch(`${config.url}/functions/v1/wisecall-kb-search`, {
      method: "POST",
      headers: {
        apikey: config.serviceRoleKey,
        Authorization: `Bearer ${config.serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ profile_id: SUPPORT_AVA_PROFILE_ID, query, match_count: 4 }),
    });
    if (!res.ok) return null;

    const data = await res.json();
    const chunks = Array.isArray(data?.chunks) ? data.chunks : [];
    const relevant = chunks
      .filter((c: { content?: string; similarity?: number }) => c?.content && typeof c.similarity === "number" && c.similarity >= 0.35)
      .map((c: { content: string }) => c.content);
    if (!relevant.length) return null;

    return "[KNOWLEDGE BASE]\n" + relevant.join("\n---\n");
  } catch (e) {
    console.error("[support-chat] kb search:", e instanceof Error ? e.message : e);
    return null;
  }
}

function buildSystemPrompt(kbContext: string | null): string {
  const sections = [
    "You are Ava, WiseCall's own in-portal support assistant. WiseCall is Owlnet's AI phone-receptionist product; you are helping an existing, signed-in WiseCall customer inside their account portal, not a prospect.",
    "",
    "Core behaviour:",
    "- Reply as live in-app chat support, short, practical, and natural. Ask one clear question at a time when you need more detail.",
    "- ALWAYS attempt to answer or troubleshoot first. Do not jump straight to escalating.",
    "- If a [KNOWLEDGE BASE] block is provided below, use it as the authoritative source for how WiseCall works.",
    "- If the question isn't covered by the knowledge base, use your general understanding of WiseCall (an AI phone receptionist with call handling, SMS/email/web-chat channels, a knowledge base per agent, number provisioning, billing plans, call transfer/routing, and a customer portal) to help, or say plainly what you don't know.",
    "- Never invent account-specific facts you can't see: exact invoice amounts, a specific customer's plan, call history, or their number status.",
    "- Use UK English.",
    "",
    "Escalating to the support team:",
    "- Only escalate when: (a) it needs account-specific access/changes you can't make yourself (billing changes, refunds, cancellations, number/porting issues), OR (b) the customer explicitly asks for a human or to raise a ticket, OR (c) you've genuinely tried to help and the issue remains unresolved.",
    "- When you do escalate, end your reply with a line in exactly this form, with nothing after it: <<<ESCALATE: a short one-line ticket subject>>>",
    "- Do not show that marker to the customer in any other way, and do not mention the marker itself. Write your normal helpful reply first, then the marker on its own line if escalating.",
  ];

  if (kbContext) sections.push("", kbContext);

  return sections.join("\n");
}

function formatTranscript(history: ChatTurn[]): string {
  return history.map((t) => `${t.role === "assistant" ? "Ava" : "Customer"}: ${t.content}`).join("\n");
}

async function callClaude(systemPrompt: string, history: ChatTurn[]): Promise<string | null> {
  const apiKey = getClaudeApiKey();
  if (!apiKey) return null;

  try {
    const anthropic = new Anthropic({ apiKey });
    const message = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 450,
      system: systemPrompt,
      messages: history.slice(-18).map((t) => ({ role: t.role, content: t.content })),
    });

    const block = message.content.find((b) => b.type === "text");
    return block && "text" in block ? block.text.trim() || null : null;
  } catch (e) {
    console.error("[support-chat] claude error:", e instanceof Error ? e.message : e);
    return null;
  }
}

export async function sendSupportChatMessage(input: {
  history: ChatTurn[];
  message: string;
  ticketAlreadyFiled: boolean;
}): Promise<SupportChatResult> {
  const message = (input.message || "").trim();
  if (!message) return { ok: false, error: "Say something and I'll take a look." };

  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const history: ChatTurn[] = [...input.history, { role: "user", content: message }];
  const kbContext = await searchSupportKb(message);
  const systemPrompt = buildSystemPrompt(kbContext);

  const raw = await callClaude(systemPrompt, history);
  if (!raw) {
    return { ok: false, error: "Ava's having trouble connecting. Please try again in a moment." };
  }

  const escalateMatch = raw.match(ESCALATE_PATTERN);
  if (!escalateMatch) {
    return { ok: true, reply: raw };
  }

  const visibleReply = raw.slice(0, escalateMatch.index).trim();
  const subject = escalateMatch[1].trim();

  if (input.ticketAlreadyFiled) {
    return { ok: true, reply: visibleReply };
  }

  const transcript = formatTranscript([...history, { role: "assistant", content: visibleReply }]);
  const ticket = await raiseSupportTicket({ subject, message: transcript });

  if (!ticket.ok) {
    return {
      ok: true,
      reply: `${visibleReply}\n\nI couldn't file that automatically — please use the "Talk to a human" link below.`,
    };
  }

  return {
    ok: true,
    reply: `${visibleReply}\n\nI've filed ticket ${ticket.ticketNumber} with our team — they'll follow up by email.`,
    ticketNumber: ticket.ticketNumber,
  };
}
