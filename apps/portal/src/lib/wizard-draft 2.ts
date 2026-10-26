const MAX_DRAFT_JSON_LENGTH = 120_000;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export type ParsedWizardDraft = {
  businessName: string;
  receptionistName: string;
  industry: string;
  greeting: string;
  prompt: string;
  knowledge: string;
  knowledgeFields: Record<string, string>;
  officeHours: Record<string, { open: string; close: string }>;
  website: string;
  templateId: string;
  voice: string;
  defaultEmail: string;
  contacts: Array<{
    id: string;
    name: string;
    phone: string;
    email: string;
    keywords: string[];
    transfer: boolean;
    notify: boolean;
    useDefaultEmail: boolean;
  }>;
  calcomApiKey?: string;
};

// Guest /setup posts the finished wizard draft with the UK number to ring them.
// Keep this structural: a truncated or hostile payload must not create an agent.
export function parseWizardDraft(input: unknown): ParsedWizardDraft | null {
  if (typeof input !== "string" || !input || input.length > MAX_DRAFT_JSON_LENGTH) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return null;
  }

  const raw = asRecord(parsed);
  if (!raw) return null;

  const businessName = asString(raw.businessName).trim();
  if (!businessName || businessName.length > 200) return null;

  const officeHoursRaw = asRecord(raw.officeHours) ?? {};
  const officeHours: ParsedWizardDraft["officeHours"] = {};
  for (const [day, hours] of Object.entries(officeHoursRaw)) {
    const slot = asRecord(hours);
    if (!slot) continue;
    const open = asString(slot.open);
    const close = asString(slot.close);
    if (open && close) officeHours[day] = { open, close };
  }

  const knowledgeFieldsRaw = asRecord(raw.knowledgeFields) ?? {};
  const knowledgeFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(knowledgeFieldsRaw)) {
    if (typeof value === "string" && value) knowledgeFields[key] = value;
  }

  const contacts: ParsedWizardDraft["contacts"] = [];
  if (Array.isArray(raw.contacts)) {
    for (const item of raw.contacts) {
      const row = asRecord(item);
      if (!row) continue;
      const id = asString(row.id);
      const name = asString(row.name);
      if (!id || !name) continue;
      contacts.push({
        id: id.slice(0, 80),
        name: name.slice(0, 120),
        phone: asString(row.phone).slice(0, 40),
        email: asString(row.email).slice(0, 200),
        keywords: Array.isArray(row.keywords)
          ? row.keywords.filter((k): k is string => typeof k === "string").slice(0, 20)
          : [],
        transfer: row.transfer === true,
        notify: row.notify === true,
        useDefaultEmail: row.useDefaultEmail === true,
      });
    }
  }

  const calcomApiKey = asString(raw.calcomApiKey).trim();

  return {
    businessName,
    receptionistName: asString(raw.receptionistName, "Receptionist").slice(0, 200),
    industry: asString(raw.industry, "General").slice(0, 80),
    greeting: asString(raw.greeting).slice(0, 2000),
    prompt: asString(raw.prompt).slice(0, 20000),
    knowledge: asString(raw.knowledge).slice(0, 40000),
    knowledgeFields,
    officeHours,
    website: asString(raw.website).slice(0, 300),
    templateId: asString(raw.templateId, "receptionist").slice(0, 80),
    voice: asString(raw.voice).slice(0, 80),
    defaultEmail: asString(raw.defaultEmail).slice(0, 200),
    contacts,
    ...(calcomApiKey ? { calcomApiKey } : {}),
  };
}
