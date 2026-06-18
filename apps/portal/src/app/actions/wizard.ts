"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";
import type { KnowledgeFields, OfficeHours } from "@/components/customer-agent-workspace";

export type AgentDraft = {
  businessName: string;
  receptionistName: string;
  industry: string;
  greeting: string;
  prompt: string;
  knowledge: string;
  knowledgeFields: KnowledgeFields;
  officeHours: OfficeHours;
  website: string;
};

export type DraftResult = { ok: boolean; draft?: AgentDraft; error?: string };

const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function normaliseUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

// Strips a fetched HTML page down to readable text so we don't blow the context
// window (or feed the model markup). Drops script/style/nav noise, collapses
// whitespace, and caps the length.
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 14000);
}

async function fetchSiteText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "WiseCallSetupBot/1.0 (+https://wisecall.io)" },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const html = await res.text();
    return htmlToText(html);
  } finally {
    clearTimeout(timer);
  }
}

// AI-assisted onboarding: fetch the customer's website and have Claude draft a
// ready-to-review agent (business context, prompt, greeting, opening hours).
// New-agent only; the user reviews/edits everything before it's created.
export async function draftAgentFromWebsite(websiteInput: string): Promise<DraftResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };
  if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
    return { ok: false, error: "Start your free trial first." };
  }

  const url = normaliseUrl(websiteInput);
  if (!url) return { ok: false, error: "That doesn't look like a valid website address." };

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "AI setup isn't switched on yet (missing ANTHROPIC_API_KEY)." };
  }

  let siteText: string;
  try {
    siteText = await fetchSiteText(url);
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error && err.name === "AbortError"
          ? "The website took too long to load. Check the address and try again."
          : "Couldn't read that website. Check the address, or set the agent up manually.",
    };
  }
  if (siteText.length < 80) {
    return {
      ok: false,
      error: "There wasn't enough readable text on that page. Try the homepage URL, or set up manually.",
    };
  }

  const anthropic = new Anthropic({ apiKey });

  try {
    const message = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 3000,
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "emit_agent_draft" },
      tools: [
        {
          name: "emit_agent_draft",
          description:
            "Return a complete first-draft configuration for an AI phone receptionist for this business.",
          input_schema: {
            type: "object",
            properties: {
              businessName: { type: "string", description: "The trading name of the business." },
              receptionistName: {
                type: "string",
                description: "A warm, professional UK first name for the AI receptionist (e.g. Olivia, Grace).",
              },
              industry: { type: "string", description: "Short industry label, e.g. 'Dental practice'." },
              greeting: {
                type: "string",
                description:
                  "The exact first sentence the receptionist says when answering, naming the business. One short sentence.",
              },
              prompt: {
                type: "string",
                description:
                  "The system prompt: how the receptionist should behave, tone, what it can help with, what to do for bookings/enquiries. UK English. 120-250 words.",
              },
              businessContext: {
                type: "string",
                description:
                  "Factual knowledge the receptionist needs: what the business does, key services, location, anything callers commonly ask. Plain prose.",
              },
              services: { type: "string", description: "Main services/products offered, comma or line separated." },
              pricing: { type: "string", description: "Any pricing found on the site, else empty string." },
              address: { type: "string", description: "Business address if found, else empty string." },
              openingHours: {
                type: "array",
                description:
                  "Opening hours ONLY if clearly stated on the site. Omit days that are closed or unknown. Empty array if none found.",
                items: {
                  type: "object",
                  properties: {
                    day: { type: "string", enum: VALID_DAYS },
                    open: { type: "string", description: "24h HH:MM, e.g. 09:00" },
                    close: { type: "string", description: "24h HH:MM, e.g. 17:30" },
                  },
                  required: ["day", "open", "close"],
                },
              },
            },
            required: [
              "businessName",
              "receptionistName",
              "industry",
              "greeting",
              "prompt",
              "businessContext",
              "services",
            ],
          },
        },
      ],
      messages: [
        {
          role: "user",
          content: `You are setting up an AI phone receptionist for a UK business. Below is the text scraped from their website (${url}). Draft a complete, ready-to-review configuration. Be specific to THIS business — use its real name, services and tone. If something isn't on the site, make a sensible professional default rather than inventing facts. Only fill opening hours if they are actually stated.\n\n--- WEBSITE TEXT ---\n${siteText}`,
        },
      ],
    });

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return { ok: false, error: "The AI couldn't draft an agent from that site. Try manual setup." };
    }
    const out = block.input as Record<string, unknown>;
    const str = (k: string): string => (typeof out[k] === "string" ? (out[k] as string) : "");

    const officeHours: OfficeHours = {};
    if (Array.isArray(out.openingHours)) {
      for (const item of out.openingHours) {
        const v = (item ?? {}) as Record<string, unknown>;
        const day = typeof v.day === "string" ? v.day : "";
        const open = typeof v.open === "string" ? v.open : "";
        const close = typeof v.close === "string" ? v.close : "";
        if (VALID_DAYS.includes(day) && /^\d{1,2}:\d{2}$/.test(open) && /^\d{1,2}:\d{2}$/.test(close)) {
          officeHours[day] = { open, close };
        }
      }
    }

    const knowledgeFields: KnowledgeFields = {
      services: str("services") || undefined,
      pricing: str("pricing") || undefined,
      address: str("address") || undefined,
      openingHours:
        Object.keys(officeHours).length > 0
          ? VALID_DAYS.filter((d) => officeHours[d])
              .map((d) => `${d}: ${officeHours[d].open}-${officeHours[d].close}`)
              .join(", ")
          : undefined,
    };

    return {
      ok: true,
      draft: {
        businessName: str("businessName") || "My business",
        receptionistName: str("receptionistName") || "Olivia",
        industry: str("industry") || "General",
        greeting: str("greeting"),
        prompt: str("prompt"),
        knowledge: str("businessContext"),
        knowledgeFields,
        officeHours,
        website: url,
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `AI draft failed: ${err.message}` : "AI draft failed.",
    };
  }
}
