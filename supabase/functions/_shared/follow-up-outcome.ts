/**
 * Deterministic next-step guarantee.
 *
 * The inbox and post-call email render "No follow-up needed" only when the
 * action-item list is empty. Model output can flag a call urgent, or describe
 * a promised callback in the summary, and still return action_items: [].
 * This module fills that gap in code so the label cannot disagree with the
 * priority or the callback language.
 */

export const URGENT_FOLLOW_UP = "Call the caller back — marked urgent";
export const CALLBACK_FOLLOW_UP =
  "Call the caller back — a callback was promised or requested";

const CALLBACK_PATTERNS: RegExp[] = [
  /\b(?:i(?:'ll| will)|we(?:'ll| will)|they(?:'ll| will)|someone will|somebody will|(?:the )?(?:team|staff|office) will)\s+(?:call|ring|phone|get back to)\b/i,
  /\bcallbacks?\s+(?:was\s+|is\s+|has been\s+)?(?:promised|arranged|requested|needed|required|booked)\b/i,
  /\bpromised\s+(?:a\s+)?callback\b/i,
  /\b(?:please|can you|could you|would you|need you to|want you to)\s+(?:call|ring|phone)\s+(?:me|us|them|him|her)?\s*back\b/i,
  /\b(?:asked|asking)\s+(?:for|you\s+)?(?:a\s+)?(?:callback|call\s*back)\b/i,
  /\b(?:need|needs|needed|want|wants|wanted|request(?:s|ed)?)\s+(?:a\s+)?callback\b/i,
  /\bcall\s+(?:you|me|them|him|her)\s+back\b/i,
  /\bget back to (?:me|you|them|him|her)\b/i,
  /\b(?:will|to)\s+call\s+(?:you|me|them|him|her)\s+back\b/i,
];

export function isUrgentPriority(value: string | null | undefined): boolean {
  const normalised = (value ?? "").trim().toLowerCase();
  return normalised === "high" || normalised === "urgent";
}

/** Explicit priority flag in a summary card, not a casual use of the word. */
export function textFlagsUrgent(text: string): boolean {
  return (
    /\b(?:priority|urgency|urgency_level)\s*[:=-]\s*(?:high|urgent)\b/i.test(text) ||
    /\bflag(?:ged)?\s+as\s+urgent\b/i.test(text) ||
    /\bmarked\s+urgent\b/i.test(text)
  );
}

function sentenceNegatesCallback(sentence: string): boolean {
  return (
    /\b(?:no|not|n't|without|never)\b(?:\s+\w+){0,5}\s+(?:a\s+)?callbacks?\b/i.test(sentence) ||
    /\b(?:don't|do not|won't|will not|cannot|can't|never)\s+(?:need to\s+|want (?:me|you|us) to\s+|have to\s+)?(?:call|ring|phone|get back)\b/i.test(
      sentence,
    ) ||
    /\bno follow-?up\b/i.test(sentence)
  );
}

export function callbackPromisedOrRequested(text: string): boolean {
  const stripped = text
    .replace(/\bcallback\s+numbers?\b/gi, " ")
    .replace(/\bbest number to call you back on\b/gi, " ");
  const sentences = stripped.split(/[\n.!?]+/);
  return sentences.some((sentence) => {
    if (sentenceNegatesCallback(sentence)) return false;
    return CALLBACK_PATTERNS.some((pattern) => pattern.test(sentence));
  });
}

function cleanItems(items: string[] | null | undefined): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
}

function usableRecommendation(value: string | null | undefined): string {
  const text = (value ?? "").trim();
  if (!text) return "";
  if (/^(none|n\/a|no follow-?up(?: needed)?|nothing|no action)\b/i.test(text)) return "";
  return text.slice(0, 280);
}

export function ensureFollowUpActions(input: {
  actionItems?: string[] | null;
  urgency?: string | null;
  summary?: string | null;
  transcript?: string | null;
  recommendedFollowUp?: string | null;
  outcome?: string | null;
}): string[] {
  const existing = cleanItems(input.actionItems);
  if (existing.length) return existing;

  const corpus = [input.summary, input.transcript, input.recommendedFollowUp, input.outcome]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join("\n");
  const urgent = isUrgentPriority(input.urgency) || textFlagsUrgent(corpus);
  const callback =
    callbackPromisedOrRequested(corpus) || /\bcallback_required\b/i.test(input.outcome ?? "");
  if (!urgent && !callback) return [];

  const recommended = usableRecommendation(input.recommendedFollowUp);
  if (recommended) return [recommended];
  return [callback ? CALLBACK_FOLLOW_UP : URGENT_FOLLOW_UP];
}

export function analysisFollowUpSignals(json: unknown): {
  urgency: string;
  summary: string;
  recommendedFollowUp: string;
  outcome: string;
} {
  if (!json || typeof json !== "object") {
    return { urgency: "", summary: "", recommendedFollowUp: "", outcome: "" };
  }
  const record = json as Record<string, unknown>;
  const str = (key: string) => (typeof record[key] === "string" ? record[key].trim() : "");
  return {
    urgency: str("urgency_level") || str("urgency"),
    summary: [str("short_manager_summary"), str("caller_intent")].filter(Boolean).join("\n"),
    recommendedFollowUp: str("recommended_follow_up"),
    outcome: str("outcome"),
  };
}
