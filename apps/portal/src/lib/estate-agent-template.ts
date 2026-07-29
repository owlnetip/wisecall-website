/**
 * Estate / lettings agent template helpers: prompt, knowledge seeds, contacts,
 * Digital Negotiator rules, viewing-request + enquiry-log webhooks.
 */

import {
  defaultNegotiatorRules,
  formatNegotiatorRulesForPrompt,
  normaliseNegotiatorRules,
  type NegotiatorRules,
} from "@/lib/digital-negotiator";
import {
  newIntegrationWebhook,
  type IntegrationWebhook,
} from "@/lib/integration-webhooks";
import { CALLER_INTAKE_PROMPT } from "@/lib/caller-intake";

type KnowledgeFields = {
  openingHours?: string;
  address?: string;
  services?: string;
  pricing?: string;
  payments?: string;
  other?: string;
};

type RoutingContact = {
  id: string;
  name: string;
  phone: string;
  email: string;
  keywords: string[];
  transfer: boolean;
  notify: boolean;
  useDefaultEmail: boolean;
};

export function buildEstateAgentPrompt(
  business: string,
  receptionist: string,
  rules?: NegotiatorRules | null,
): string {
  const who = receptionist || "the receptionist";
  const biz = business || "the agency";
  const negotiatorRules = normaliseNegotiatorRules(rules ?? defaultNegotiatorRules());
  return [
    `You are ${who}, a warm, professional AI Digital Negotiator for ${biz}, a UK estate and lettings agency.`,
    "Your job is to help callers with valuations, viewings, sales, lettings and property management enquiries — especially out of hours.",
    "",
    "CALLER TYPES — identify early:",
    "- Buyer / tenant looking to view a property",
    "- Seller / landlord wanting a valuation or to instruct",
    "- Existing tenant (maintenance, rent, notice)",
    "- Existing landlord (management, tenancy update)",
    "- General / other",
    "",
    "QUALIFICATION (buyers / tenants)",
    "Before booking a viewing, capture and confirm:",
    "1. Full name and best mobile number",
    "2. Budget (or rent budget) — rough band is fine",
    "3. Preferred areas / postcodes",
    "4. Minimum bedrooms",
    "5. Move timeline (e.g. ASAP, 1–3 months)",
    "6. Financing: mortgage agreed / cash / needs advice — do not give advice",
    "7. Whether they have a property to sell (valuation opportunity)",
    "Then call log_enquiry with party_role buyer or tenant and the fields you captured.",
    "If qualification is incomplete but they insist on a slot, still log_enquiry with status qualifying and needs_human true.",
    "",
    "VIEWING BOOKING (owner-confirm flow)",
    "When someone wants to view a property and (per rules) is ready to book:",
    "1. Capture: caller name, phone (confirm the number if needed), property address or listing reference, and preferred date/time.",
    "2. If they only have a vague time, offer 2–3 concrete slots within office hours.",
    "3. Call the request_viewing tool with:",
    "   - address (or property_id if you know it)",
    "   - owner_phone when creating from address (from knowledge / staff notes — never invent)",
    "   - starts_at as an ISO datetime",
    "   - viewer_name, viewer_phone",
    "4. Tell the caller you'll confirm once the owner approves — do NOT say the viewing is booked until the tool returns status confirmed or pending_owner.",
    "5. If the tool returns pending_owner: say the owner has been texted and you'll confirm shortly by SMS.",
    "6. If agent_available is false: still request the slot, but note a negotiator may need to rearrange.",
    "7. After requesting a viewing, call log_enquiry with status viewing_requested and the same qualification fields.",
    "",
    "VALUATIONS",
    "- Capture name, phone, property address, sale vs let, and preferred callback/valuation window.",
    "- Call log_enquiry with party_role vendor or landlord.",
    "- Book a valuation callback into the team's workflow (message / follow-up) unless a booking tool is available.",
    "",
    "MAINTENANCE / TENANT ISSUES",
    "- Capture address, issue, urgency, access notes. For emergencies (gas leak, flood, no heat in winter, lock-out) escalate or transfer per routing contacts.",
    "",
    CALLER_INTAKE_PROMPT,
    "",
    "RULES",
    "- UK English. Keep answers short — this is a phone call.",
    "- Never invent fees, EPC ratings, offer status or owner availability.",
    "- Never invent an owner phone number. If missing, take a message for the branch to arrange the viewing.",
    "- Do not give legal or financial advice.",
    "- You qualify and book — you do NOT negotiate price, terms, or offers. Hand those to a human negotiator.",
    "",
    formatNegotiatorRulesForPrompt(negotiatorRules),
  ].join("\n");
}

export function buildEstateAgentGreeting(business: string, receptionist: string): string {
  const who = receptionist || "the receptionist";
  const biz = business || "the agency";
  return `Hi, thanks for calling ${biz}, you're through to ${who}. Are you calling about a viewing, a valuation, or something else?`;
}

export function estateAgentKnowledgeFields(): KnowledgeFields {
  return {
    openingHours: "Mon–Fri 9am–6pm, Sat 10am–2pm, closed Sunday",
    address: "[Branch address and parking]",
    services:
      "Sales, lettings, valuations, viewings, property management. Free market appraisals available.",
    pricing: "Standard sales and lettings fees — confirm current rates with the branch before quoting.",
    payments: "Holding deposits and referencing handled by the lettings team.",
    other:
      "Viewings are confirmed with the property owner by text/WhatsApp before they are final. Callers receive an SMS once approved. Out-of-hours enquiries are qualified and booked by the Digital Negotiator.",
  };
}

export function estateAgentDefaultContacts(): RoutingContact[] {
  return [
    {
      id: crypto.randomUUID(),
      name: "Negotiator / viewings",
      phone: "",
      email: "",
      keywords: ["viewing", "view", "book a viewing", "arrange a viewing", "open house"],
      transfer: false,
      notify: true,
      useDefaultEmail: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Valuations",
      phone: "",
      email: "",
      keywords: ["valuation", "appraisal", "sell my house", "instruct", "market appraisal"],
      transfer: false,
      notify: true,
      useDefaultEmail: true,
    },
    {
      id: crypto.randomUUID(),
      name: "Maintenance emergencies",
      phone: "",
      email: "",
      keywords: [
        "emergency",
        "gas leak",
        "flood",
        "no heating",
        "no hot water",
        "locked out",
        "boiler",
      ],
      transfer: true,
      notify: true,
      useDefaultEmail: false,
    },
  ];
}

/** During-call tool that kicks off the owner-confirm viewing loop. */
export function buildEstateViewingWebhook(opts: {
  supabaseUrl: string;
  smsSecret?: string | null;
}): IntegrationWebhook {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const headers: { key: string; value: string }[] = [];
  if (opts.smsSecret) {
    headers.push({ key: "X-WiseCall-SMS-Secret", value: opts.smsSecret });
  }

  return newIntegrationWebhook({
    name: "request_viewing",
    friendlyName: "Request property viewing",
    description:
      "Request a property viewing at a date/time. Checks agent availability when Cal.com is connected, texts/WhatsApps the owner for YES/NO, then confirms the viewer by SMS.",
    condition: "during_call",
    method: "POST",
    url: `${base}/functions/v1/wisecall-viewing-request`,
    enabled: true,
    headers,
    parameters: [
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "callerId", value: "{{caller_id}}" },
      { key: "viewer_phone", value: "{{caller_id}}" },
      { key: "viewer_name", value: "" },
      { key: "address", value: "" },
      { key: "owner_phone", value: "" },
      { key: "property_id", value: "" },
      { key: "starts_at", value: "" },
      { key: "source", value: "phone" },
    ],
  });
}

/** During-call tool that persists a qualified enquiry for the weekend digest. */
export function buildQualifyEnquiryWebhook(opts: {
  supabaseUrl: string;
  smsSecret?: string | null;
}): IntegrationWebhook {
  const base = opts.supabaseUrl.replace(/\/$/, "");
  const headers: { key: string; value: string }[] = [];
  if (opts.smsSecret) {
    headers.push({ key: "X-WiseCall-SMS-Secret", value: opts.smsSecret });
  }

  return newIntegrationWebhook({
    name: "log_enquiry",
    friendlyName: "Log qualified enquiry",
    description:
      "Save a buyer, tenant, vendor or landlord enquiry with qualification details (budget, area, beds, timeline) so the branch sees it in the Digital Negotiator weekend results.",
    condition: "during_call",
    method: "POST",
    url: `${base}/functions/v1/wisecall-qualify-enquiry`,
    enabled: true,
    headers,
    parameters: [
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "callerId", value: "{{caller_id}}" },
      { key: "contact_phone", value: "{{caller_id}}" },
      { key: "contact_name", value: "" },
      { key: "party_role", value: "buyer" },
      { key: "status", value: "qualified" },
      { key: "budget_text", value: "" },
      { key: "budget_max", value: "" },
      { key: "areas", value: "" },
      { key: "beds_min", value: "" },
      { key: "move_timeline", value: "" },
      { key: "financing", value: "" },
      { key: "has_property_to_sell", value: "" },
      { key: "listing_interest", value: "" },
      { key: "listing_ref", value: "" },
      { key: "summary", value: "" },
      { key: "needs_human", value: "" },
      { key: "human_reason", value: "" },
      { key: "source", value: "phone" },
    ],
  });
}
