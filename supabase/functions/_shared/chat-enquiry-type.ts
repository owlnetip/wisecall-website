// Classifies a website-chat visitor's enquiry as seller / buyer / general from
// their own words, so the one post-chat email can go to the right department
// (profile.metadata.chat_enquiry_routing). Strong words ("sell", "buy") set or
// change the type; weaker hints only fill it in when nothing is set yet.

export type EnquiryType = "seller" | "buyer" | "general";

const STRONG: Array<[EnquiryType, RegExp]> = [
  ["seller", /\b(sell|selling|sale of (my|our)|sell(ing)? (my|our))\b/],
  ["buyer", /\b(buy|buying|purchase|purchasing|buyer|investor)\b/],
  ["general", /\b(general (enquiry|inquiry|question)|just a general|other enquiry|general)\b/],
];

const WEAK: Array<[EnquiryType, RegExp]> = [
  ["seller", /\b(valuation|value (of )?my|cash offer|quick sale|probate|reposs|downsiz|my (house|home|property|flat|bungalow))\b/],
  ["buyer", /\b(looking for a (house|home|property|flat)|properties (for sale|available)|available properties|portfolio|rental yield)\b/],
];

function firstMatch(text: string, rules: Array<[EnquiryType, RegExp]>): EnquiryType | null {
  let best: { type: EnquiryType; index: number } | null = null;
  for (const [type, pattern] of rules) {
    const match = pattern.exec(text);
    if (match && (best === null || match.index < best.index)) best = { type, index: match.index };
  }
  return best?.type ?? null;
}

export function detectEnquiryType(message: string, current?: unknown): EnquiryType | null {
  const text = String(message || "").toLowerCase();
  const strong = firstMatch(text, STRONG);
  if (strong) return strong;
  const existing = current === "seller" || current === "buyer" || current === "general" ? current : null;
  if (existing) return null; // keep what we have; no change
  return firstMatch(text, WEAK);
}
