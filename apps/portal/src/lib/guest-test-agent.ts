import { DEFAULT_VOICE_ID } from "./voices";
import type { ParsedWizardDraft } from "./wizard-draft";

export const GUEST_TEST_AGENT_SOURCE = "guest_setup_test";
export const AVA_DEMO_SLUG = "wisecall";

const AVA_DEMO_DIGITS = new Set(["441135222277", "01135222277", "441135221606"]);

export const ALWAYS_OPEN_OFFICE_HOURS: Record<string, { open: string; close: string }> = {
  mon: { open: "00:00", close: "23:59" },
  tue: { open: "00:00", close: "23:59" },
  wed: { open: "00:00", close: "23:59" },
  thu: { open: "00:00", close: "23:59" },
  fri: { open: "00:00", close: "23:59" },
  sat: { open: "00:00", close: "23:59" },
  sun: { open: "00:00", close: "23:59" },
};

export function isGuestTestAgentMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.source === GUEST_TEST_AGENT_SOURCE || record.guest_test === true;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function guestTestAgentSlug(businessName: string, unique: string): string {
  const base = slugify(businessName) || "agent";
  return `guest-${base}-${unique}`.slice(0, 80);
}

export function guestTestVoiceName(): string {
  return DEFAULT_VOICE_ID;
}

function phoneDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export function isAvaDemoSlug(slug: string): boolean {
  return slug.trim().toLowerCase() === AVA_DEMO_SLUG;
}

export function isAvaDemoNumber(value: string): boolean {
  const digits = phoneDigits(value);
  if (AVA_DEMO_DIGITS.has(digits)) return true;
  return digits.endsWith("1135222277") && digits.length >= 10 && digits.length <= 13;
}

// Routing key the voice edge matches as called_number. Not a real DDI — +4455
// is unused in the UK, so inbound will never collide with Ava or pooled numbers.
export function guestRoutingNumber(unique: string): string {
  const hex = unique.replace(/[^0-9a-f]/gi, "").toLowerCase().padEnd(12, "0").slice(0, 12);
  const nine = (BigInt(`0x${hex}`) % BigInt("1000000000")).toString().padStart(9, "0");
  return `+4455${nine}`;
}

export const GUEST_CALLBACK_MISSING_AGENT =
  "Could not start the test call on the receptionist we just drafted. Try again.";

export function guestCallbackTargetError(opts: {
  slug: string;
  calledNumber: string;
}): string | null {
  if (!opts.slug || isAvaDemoSlug(opts.slug) || !opts.slug.startsWith("guest-")) {
    return GUEST_CALLBACK_MISSING_AGENT;
  }
  if (!opts.calledNumber || isAvaDemoNumber(opts.calledNumber)) {
    return GUEST_CALLBACK_MISSING_AGENT;
  }
  return null;
}

export type GuestTestVoiceRuntime = {
  ttsProvider: string;
  voiceId: string | null;
  voiceName: string;
};

export function buildGuestTestAgentInsert(
  draft: ParsedWizardDraft,
  opts: { slug: string; routingNumber: string; voice: GuestTestVoiceRuntime },
): Record<string, unknown> {
  const businessName = draft.businessName.trim();
  const receptionistName = draft.receptionistName.trim() || `${businessName} assistant`;
  const email = draft.defaultEmail.trim();
  const metadata: Record<string, unknown> = {
    source: GUEST_TEST_AGENT_SOURCE,
    guest_test: true,
    industry: draft.industry,
    greeting: draft.greeting,
    voice: opts.voice.voiceName,
    tts_provider: opts.voice.ttsProvider,
    tts_voice_id: opts.voice.voiceId,
    knowledge: draft.knowledge,
    knowledge_fields: {
      ...draft.knowledgeFields,
      openingHours: "Open all the time",
    },
    website: draft.website,
    template_id: draft.templateId,
    office_hours: ALWAYS_OPEN_OFFICE_HOURS,
    routing: {
      provider: "guest_test",
      number: opts.routingNumber,
      status: "test",
    },
  };
  if (email) metadata.default_routing_email = email;

  return {
    slug: opts.slug,
    profile_name: `${businessName} test`,
    business_name: businessName,
    clinic_name: businessName,
    receptionist_name: receptionistName,
    system_prompt: draft.prompt,
    greeting: draft.greeting,
    business_context: draft.knowledge,
    timezone: "Europe/London",
    is_active: true,
    telnyx_number: opts.routingNumber,
    cartesia_voice_id: opts.voice.voiceId,
    metadata,
  };
}

export function guestTestCallbackBody(opts: {
  phone: string;
  slug: string;
  calledNumber: string;
  agentName: string;
}): {
  phone: string;
  profile_slug: string;
  called_number: string;
  agent_name: string;
  source: string;
} {
  return {
    phone: opts.phone,
    profile_slug: opts.slug,
    called_number: opts.calledNumber,
    agent_name: opts.agentName,
    source: GUEST_TEST_AGENT_SOURCE,
  };
}
