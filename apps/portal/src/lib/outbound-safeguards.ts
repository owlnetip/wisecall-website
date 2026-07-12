export const OUTBOUND_RECIPIENT_CAP = 500;
export const LARGE_BLAST_THRESHOLD = 100;

export type OutboundRecipientCandidate = {
  toNumber: string;
  contactName?: string;
  mergeFields?: Record<string, string>;
};

export type OutboundRecipientReview = {
  importedCount: number;
  recipientCount: number;
  duplicateCount: number;
  invalidNumberCount: number;
  estimatedCallAttempts: number;
  recipients: OutboundRecipientCandidate[];
};

export function normaliseOutboundNumber(value: string): string | null {
  let number = value.trim().replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = `+${number.slice(2)}`;

  if (/^\+\d{8,15}$/.test(number)) return number;

  // WiseCall currently serves UK businesses, so accept familiar UK local
  // numbers while storing one canonical form for duplicate detection.
  if (/^0\d{9,10}$/.test(number)) return `+44${number.slice(1)}`;

  return null;
}

export function prepareOutboundRecipients(
  candidates: OutboundRecipientCandidate[],
  maxAttempts: number,
): OutboundRecipientReview {
  const seen = new Set<string>();
  const recipients: OutboundRecipientCandidate[] = [];
  let duplicateCount = 0;
  let invalidNumberCount = 0;

  for (const candidate of candidates) {
    const toNumber = normaliseOutboundNumber(candidate.toNumber || "");
    if (!toNumber) {
      invalidNumberCount += 1;
      continue;
    }
    if (seen.has(toNumber)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(toNumber);
    recipients.push({ ...candidate, toNumber });
  }

  const attempts = Math.min(5, Math.max(1, Math.trunc(maxAttempts) || 1));
  return {
    importedCount: candidates.length,
    recipientCount: recipients.length,
    duplicateCount,
    invalidNumberCount,
    estimatedCallAttempts: recipients.length * attempts,
    recipients,
  };
}

export function getLargeBlastConfirmation(recipientCount: number): string | null {
  return recipientCount >= LARGE_BLAST_THRESHOLD ? `START ${recipientCount}` : null;
}

export function isValidIdempotencyKey(value: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(value);
}
