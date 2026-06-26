"use server";

import Anthropic from "@anthropic-ai/sdk";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";
import type {
  KnowledgeFields,
  OfficeHours,
  RoutingContact,
} from "@/components/customer-agent-workspace";

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
  // Guided-setup extras the wizard fills in after the scan. Defaulted here so a
  // freshly scanned draft is already valid; the user reviews/changes each one.
  templateId: string; // matched agent template (receptionist / dentally …)
  voice: string; // chosen Cartesia voice id ("" → wizard uses the default)
  defaultEmail: string; // where call messages + transcripts are sent
  contacts: RoutingContact[]; // staff/colleagues for transfers + notifications
};

// Maps the AI-detected industry to one of our agent templates so the wizard can
// pre-select it. Specialised templates (e.g. dental booking) only match on a
// clear signal; everything else falls back to the general receptionist.
function matchTemplateId(industry: string, context: string): string {
  const hay = `${industry} ${context}`.toLowerCase();
  if (/\bdent|orthodont|dental practice\b/.test(hay)) return "dentally";
  return "receptionist";
}

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

const FETCH_UA =
  "Mozilla/5.0 (compatible; WiseCall/1.0; +https://wisecall.io) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchSiteTextDirect(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "user-agent": FETCH_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-GB,en;q=0.9",
      },
    });
    if (!res.ok) throw new Error(`Site returned ${res.status}`);
    const html = await res.text();
    return htmlToText(html);
  } finally {
    clearTimeout(timer);
  }
}

// Fallback for Cloudflare-protected or bot-blocked sites. Uses the same Jina
// stack as kb-search embeddings — get a free key at https://jina.ai/?sui=apikey.
async function fetchSiteTextViaJina(url: string): Promise<string> {
  const apiKey = process.env.JINA_API_KEY;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-Retain-Images": "none",
    };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    const res = await fetch("https://r.jina.ai/", {
      method: "POST",
      signal: controller.signal,
      headers,
      body: JSON.stringify({ url }),
    });
    if (!res.ok) throw new Error(`Reader returned ${res.status}`);
    const data = (await res.json()) as { data?: { content?: string } };
    const text = data.data?.content?.trim() ?? "";
    if (!text) throw new Error("Reader returned no content");
    return text.slice(0, 14000);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSiteText(url: string): Promise<string> {
  try {
    const direct = await fetchSiteTextDirect(url);
    if (direct.length >= 80) return direct;
  } catch {
    // Direct fetch often fails on Cloudflare/WAF-protected sites — try Reader.
  }
  return fetchSiteTextViaJina(url);
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

  // Accept either name so the key set in Vercel works whichever it's called.
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE;
  if (!apiKey) {
    return { ok: false, error: "AI setup isn't switched on yet (missing Claude API key)." };
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
      model: "claude-sonnet-4-6",
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
                description:
                  "The assistant's name. ALWAYS the business's trading name followed by ' assistant' (e.g. 'Northwind assistant'). Never a personal first name.",
              },
              industry: { type: "string", description: "Short industry label, e.g. 'Dental practice'." },
              greeting: {
                type: "string",
                description:
                  "The exact first sentence the assistant says when answering, naming the business. Start with a neutral greeting — 'Hi', 'Hello' or 'Welcome' — and NEVER a time-of-day greeting like 'Good morning' or 'Good afternoon'. Do not use a personal name. One short sentence.",
              },
              prompt: {
                type: "string",
                description:
                  "The system prompt: how the assistant should behave, tone, what it can help with, what to do for bookings/enquiries. The assistant refers to itself as the [business] assistant, never a personal name, and never uses time-of-day greetings. UK English. 120-250 words.",
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

    const businessName = str("businessName") || "My business";
    // Enforce the company-assistant identity regardless of what the model returns:
    // the assistant is always "{business} assistant", never a personal name.
    const receptionistName = `${businessName} assistant`;
    // Strip any leading time-of-day greeting ("Good morning,"/"Good afternoon" …)
    // the model may still have produced, replacing it with a neutral "Hi".
    const greeting = str("greeting").replace(
      /^\s*(good\s+(morning|afternoon|evening))\b[\s,!-]*/i,
      "Hi, ",
    );

    return {
      ok: true,
      draft: {
        businessName,
        receptionistName,
        industry: str("industry") || "General",
        greeting,
        prompt: str("prompt"),
        knowledge: str("businessContext"),
        knowledgeFields,
        officeHours,
        website: url,
        templateId: matchTemplateId(str("industry"), str("businessContext")),
        voice: "",
        // Pre-fill the messages inbox with the account holder's email — the most
        // common answer — so most users just confirm it in the wizard.
        defaultEmail: user.email ?? "",
        contacts: [],
      },
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `AI draft failed: ${err.message}` : "AI draft failed.",
    };
  }
}
