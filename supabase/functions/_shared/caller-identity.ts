// Resolve caller name + company for team email/SMS from analysis, collected
// fields, or a light pass over the summary/transcript.

export type CallerIdentity = {
  callerId: string;
  callerName: string;
  company: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = str(record[key]);
    if (value) return value.slice(0, 80);
  }
  return "";
}

function cleanCompany(raw: string): string {
  const value = raw.replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/g, "");
  if (!value || value.length < 2 || value.length > 80) return "";
  if (/^\+?\d[\d\s()-]{6,}$/.test(value)) return "";
  if (/^(unknown|n\/a|na|none|personal|private)$/i.test(value)) return "";
  return value;
}

const COMPANY_PATTERNS: RegExp[] = [
  /\bcompany(?:\s+name)?(?: is|:)\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
  /\bcalling from\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
  /\b(?:I work for|we(?:'re| are) (?:from|with))\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
  /\bfrom\s+([A-Z][A-Za-z0-9&.' -]{2,60})(?:\s+(?:Ltd|Limited|PLC|LLP|Inc)\b)?/,
];

export function extractCompanyFromText(text: string): string {
  if (!text?.trim()) return "";
  for (const pattern of COMPANY_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanCompany(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return "";
}

export function resolveCallerIdentity(input: {
  callerId?: string;
  collected?: unknown;
  analysis?: unknown;
  summary?: string;
  transcript?: string;
}): CallerIdentity {
  const collected = isPlainObject(input.collected) ? input.collected : {};
  const analysis = isPlainObject(input.analysis) ? input.analysis : {};
  const callerId = str(input.callerId) || "Unknown";

  const callerName = firstString(analysis, ["caller_name", "contact_name", "name"]) ||
    firstString(collected, ["caller_name", "contact_name", "name"]);

  const company =
    cleanCompany(firstString(analysis, ["company", "company_name", "contact_company"])) ||
    cleanCompany(firstString(collected, ["company", "company_name", "contact_company"])) ||
    extractCompanyFromText(input.summary ?? "") ||
    extractCompanyFromText(input.transcript ?? "");

  return { callerId, callerName, company };
}

/** Phone plus name/company for the email Caller row. */
export function formatCallerDisplay(identity: CallerIdentity): string {
  const phone = identity.callerId.trim() || "Unknown";
  const name = identity.callerName.trim();
  const company = identity.company.trim();
  if (name && company) return `${name} (${company}) · ${phone}`;
  if (name) return `${name} · ${phone}`;
  if (company) return `${company} · ${phone}`;
  return phone;
}
