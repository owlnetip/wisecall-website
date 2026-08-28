import { DEFAULT_VOICE_ID, getVoiceOption } from "./voices";
import type { ParsedWizardDraft } from "./wizard-draft";

export const GUEST_TEST_AGENT_SOURCE = "guest_setup_test";

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

export type GuestTestVoiceRuntime = {
  ttsProvider: string;
  voiceId: string | null;
  voiceName: string;
};

export function guestTestVoiceName(voice: string | null | undefined): string {
  return getVoiceOption(voice)?.id ?? DEFAULT_VOICE_ID;
}

export function buildGuestTestAgentInsert(
  draft: ParsedWizardDraft,
  opts: { slug: string; voice: GuestTestVoiceRuntime },
): Record<string, unknown> {
  const businessName = draft.businessName.trim();
  const receptionistName = draft.receptionistName.trim() || `${businessName} assistant`;
  const metadata: Record<string, unknown> = {
    source: GUEST_TEST_AGENT_SOURCE,
    guest_test: true,
    industry: draft.industry,
    greeting: draft.greeting,
    voice: opts.voice.voiceName,
    tts_provider: opts.voice.ttsProvider,
    tts_voice_id: opts.voice.voiceId,
    knowledge: draft.knowledge,
    knowledge_fields: draft.knowledgeFields,
    website: draft.website,
    template_id: draft.templateId,
    office_hours: draft.officeHours,
  };

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
    cartesia_voice_id: opts.voice.voiceId,
    metadata,
  };
}

export function guestTestCallbackBody(opts: {
  phone: string;
  slug: string;
  agentName: string;
}): {
  phone: string;
  profile_slug: string;
  agent_name: string;
  source: string;
} {
  return {
    phone: opts.phone,
    profile_slug: opts.slug,
    agent_name: opts.agentName,
    source: GUEST_TEST_AGENT_SOURCE,
  };
}
