// Extract company and callback number from call transcripts/summaries.

function cleanCompany(raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/g, "");
  if (!value || value.length < 2 || value.length > 80) return null;
  if (/^\+?\d[\d\s()-]{6,}$/.test(value)) return null;
  return value;
}

const COMPANY_PATTERNS: RegExp[] = [
  /\b(?:from|with|at|for)\s+([A-Z][A-Za-z0-9&.' -]{2,60})(?:\s+(?:Ltd|Limited|PLC|LLP|Inc|UK))?/,
  /\bcompany(?: is|:)\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
  /\bcalling from\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
  /\b(?:I work for|we are)\s+([A-Z][A-Za-z0-9&.' -]{2,60})/i,
];

const CALLBACK_PATTERNS: RegExp[] = [
  /\bcallback(?:\s+number)?(?: is|:)\s*(\+?\d[\d\s()-]{8,})/i,
  /\bcall(?:\s+me)?\s+(?:back\s+)?on\s+(\+?\d[\d\s()-]{8,})/i,
  /\bbest number(?: is|:)\s*(\+?\d[\d\s()-]{8,})/i,
  /\bmobile(?: is|:)\s*(\+?\d[\d\s()-]{8,})/i,
];

function normalisePhone(raw: string): string {
  return raw.replace(/[^\d+]/g, "").trim();
}

export function extractCompanyFromText(text: string): string | null {
  if (!text?.trim()) return null;
  for (const pattern of COMPANY_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanCompany(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

export function extractCallbackPhoneFromText(text: string): string | null {
  if (!text?.trim()) return null;
  for (const pattern of CALLBACK_PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const phone = normalisePhone(match[1]);
      if (phone.length >= 10) return phone;
    }
  }
  return null;
}

export function extractCallerDetailsFromCall(input: {
  summary?: string | null;
  transcript?: string | null;
}): { company?: string; callbackPhone?: string } {
  const combined = [input.summary, input.transcript].filter(Boolean).join("\n");
  const company =
    extractCompanyFromText(input.summary ?? "") ||
    extractCompanyFromText(input.transcript ?? "");
  const callbackPhone =
    extractCallbackPhoneFromText(combined) ||
    extractCallbackPhoneFromText(input.transcript ?? "");
  return {
    ...(company ? { company } : {}),
    ...(callbackPhone ? { callbackPhone } : {}),
  };
}
