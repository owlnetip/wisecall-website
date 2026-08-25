"use server";

import Anthropic from "@anthropic-ai/sdk";
import { authorizeWizardPreview } from "@/lib/wizard-preview-auth";
import {
  PublicUrlError,
  assertPublicHttpUrl,
} from "@/lib/public-url";
import type {
  KnowledgeFields,
  OfficeHours,
  RoutingContact,
} from "@/components/customer-agent-workspace";
import { matchAgentTemplateId } from "@/lib/agent-templates";
import { buildWebsiteKnowledgeUrls } from "@/lib/website-kb-paths";
import { fetchSiteText, fetchSupplementaryWebsiteText } from "@/lib/website-fetch";

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
  voice: string; // chosen voice id ("" → wizard uses the default)
  defaultEmail: string; // where call messages + transcripts are sent
  contacts: RoutingContact[]; // staff/colleagues for transfers + notifications
  // Cal.com API key, only collected for booking templates. The agent doesn't
  // exist yet at that point in the wizard, so it's connected straight after
  // creation and never persisted on the draft.
  calcomApiKey?: string;
};

export type DraftResult = { ok: boolean; draft?: AgentDraft; error?: string };

export type BusinessInputs = {
  businessName: string;
  industry: string;
  services: string;
  address: string;
  openingHoursText: string;
  pricing: string;
  payments: string;
  extra: string;
};

const VALID_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function normaliseUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    return u.toString();
  } catch {
    return null;
  }
}

// Strips a fetched HTML page down to readable text so we don't blow the context
// ready-to-review agent (business context, prompt, greeting, opening hours).
// New-agent only; the user reviews/edits everything before it's created.
export async function draftAgentFromWebsite(websiteInput: string): Promise<DraftResult> {
  const access = await authorizeWizardPreview("draft");
  if (!access.ok) return { ok: false, error: access.error };

  const normalisedUrl = normaliseUrl(websiteInput);
  if (!normalisedUrl) {
    return { ok: false, error: "That doesn't look like a valid website address." };
  }

  let url: string;
  try {
    url = (await assertPublicHttpUrl(normalisedUrl)).toString();
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof PublicUrlError
          ? error.message
          : "That doesn't look like a valid public website address.",
    };
  }

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
        err instanceof PublicUrlError
          ? err.message
          : err instanceof Error && err.name === "AbortError"
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

  const supplementaryUrls = buildWebsiteKnowledgeUrls(url).slice(1, 5);
  const supplementaryText = await fetchSupplementaryWebsiteText(supplementaryUrls);
  const combinedSiteText = [siteText, ...supplementaryText].join("\n\n").slice(0, 28000);

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
                  "The exact first sentence the assistant says when answering, naming the business. Start with a neutral greeting: 'Hi', 'Hello' or 'Welcome', and NEVER a time-of-day greeting like 'Good morning' or 'Good afternoon'. Do not use a personal name. One short sentence.",
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
          content: `You are setting up an AI phone receptionist for a UK business. Below is text scraped from their website (${url}) plus common pages such as fees/pricing when available. Draft a complete, ready-to-review configuration. Be specific to THIS business: use its real name, services and tone. If something isn't on the site, make a sensible professional default rather than inventing facts. Only fill opening hours if they are actually stated. When fee tables are present, copy exact published prices into the pricing field.\n\n--- WEBSITE TEXT ---\n${combinedSiteText}`,
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
        templateId: matchAgentTemplateId(str("industry"), str("businessContext")),
        voice: "",
        // Pre-fill the messages inbox with the account holder's email, the most
        // common answer, so most users just confirm it in the wizard.
        defaultEmail: access.email,
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

// Shared helper: parse the AI tool-use output into an AgentDraft.
function parseDraftOutput(
  out: Record<string, unknown>,
  defaults: { website?: string; defaultEmail?: string },
): AgentDraft {
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
  const greeting = str("greeting").replace(
    /^\s*(good\s+(morning|afternoon|evening))\b[\s,!-]*/i,
    "Hi, ",
  );
  return {
    businessName,
    receptionistName: `${businessName} assistant`,
    industry: str("industry") || "General",
    greeting,
    prompt: str("prompt"),
    knowledge: str("businessContext"),
    knowledgeFields,
    officeHours,
    website: defaults.website ?? "",
    templateId: matchAgentTemplateId(str("industry"), str("businessContext")),
    voice: "",
    defaultEmail: defaults.defaultEmail ?? "",
    contacts: [],
  };
}

// The shared Anthropic tool definition for agent-draft generation.
const EMIT_AGENT_DRAFT_TOOL: Anthropic.Messages.Tool = {
  name: "emit_agent_draft",
  description: "Return a complete first-draft configuration for an AI phone receptionist for this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      businessName: { type: "string", description: "The trading name of the business." },
      receptionistName: {
        type: "string",
        description: "The assistant's name. ALWAYS the business's trading name followed by ' assistant'. Never a personal first name.",
      },
      industry: { type: "string", description: "Short industry label, e.g. 'Dental practice'." },
      greeting: {
        type: "string",
        description:
          "The exact first sentence the assistant says when answering, naming the business. Start with a neutral greeting, 'Hi', 'Hello' or 'Welcome', NEVER a time-of-day greeting. One short sentence.",
      },
      prompt: {
        type: "string",
        description:
          "System prompt: how the assistant should behave, tone, what it can help with. UK English. 120-250 words.",
      },
      businessContext: {
        type: "string",
        description: "Factual knowledge the receptionist needs: services, location, FAQs. Plain prose.",
      },
      services: { type: "string", description: "Main services/products, comma or line separated." },
      pricing: { type: "string", description: "Any pricing info, else empty string." },
      address: { type: "string", description: "Business address if known, else empty string." },
      openingHours: {
        type: "array",
        description: "Opening hours if provided. Omit closed/unknown days. Empty array if none.",
        items: {
          type: "object",
          properties: {
            day: { type: "string", enum: VALID_DAYS },
            open: { type: "string", description: "24h HH:MM" },
            close: { type: "string", description: "24h HH:MM" },
          },
          required: ["day", "open", "close"],
        },
      },
    },
    required: ["businessName", "receptionistName", "industry", "greeting", "prompt", "businessContext", "services"],
  },
};

// Builds an AgentDraft from manually-entered business details instead of a website scan.
// The AI call is identical, we just feed it structured text instead of scraped HTML.
export async function draftAgentFromInputs(inputs: BusinessInputs): Promise<DraftResult> {
  const access = await authorizeWizardPreview("draft");
  if (!access.ok) return { ok: false, error: access.error };
  if (!inputs.businessName.trim()) return { ok: false, error: "Business name is required." };

  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE;
  if (!apiKey) return { ok: false, error: "AI setup isn't switched on yet (missing Claude API key)." };

  const lines: string[] = [
    `Business name: ${inputs.businessName.trim()}`,
    inputs.industry ? `Industry: ${inputs.industry.trim()}` : "",
    inputs.services ? `Services: ${inputs.services.trim()}` : "",
    inputs.address ? `Address: ${inputs.address.trim()}` : "",
    inputs.openingHoursText ? `Opening hours: ${inputs.openingHoursText.trim()}` : "",
    inputs.pricing ? `Pricing: ${inputs.pricing.trim()}` : "",
    inputs.payments ? `Payments / insurance: ${inputs.payments.trim()}` : "",
    inputs.extra ? `Additional info: ${inputs.extra.trim()}` : "",
  ].filter(Boolean);

  const anthropic = new Anthropic({ apiKey });
  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      thinking: { type: "disabled" },
      tool_choice: { type: "tool", name: "emit_agent_draft" },
      tools: [EMIT_AGENT_DRAFT_TOOL],
      messages: [
        {
          role: "user",
          content: `You are setting up an AI phone receptionist for a UK business. The customer has provided the following details about their business. Draft a complete, ready-to-review configuration based exactly on what they've told you. Where information is missing, use sensible professional defaults rather than inventing facts.\n\n${lines.join("\n")}`,
        },
      ],
    });

    const block = message.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      return { ok: false, error: "The AI couldn't draft an agent from those details. Try filling in more information." };
    }
    const out = block.input as Record<string, unknown>;
    return {
      ok: true,
      draft: parseDraftOutput(out, { defaultEmail: access.email }),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? `AI draft failed: ${err.message}` : "AI draft failed.",
    };
  }
}
