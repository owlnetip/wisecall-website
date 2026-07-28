/** Extract published £ fee lines from scraped website / fees-page text. */

const FEE_LINE_RE = /([A-Za-z][A-Za-z0-9 ()/&.,'-]{1,80}?)\s*£\s*([\d,]+(?:\.\d{2})?)/g;

export function extractPublishedFeeLines(text: string, limit = 40): string[] {
  const flat = String(text || "").replace(/\s+/g, " ").trim();
  if (!flat) return [];

  const lines: string[] = [];
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  FEE_LINE_RE.lastIndex = 0;
  while ((match = FEE_LINE_RE.exec(flat)) !== null) {
    const label = match[1].trim().replace(/\s+/g, " ");
    // Skip nav / junk labels that aren't treatments.
    if (label.length < 3 || /^(home|fees|menu|cookie|privacy|book|call|email)\b/i.test(label)) {
      continue;
    }
    const amount = match[2].replace(/,/g, "");
    const line = `${label}: £${amount}`;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= limit) break;
  }
  return lines;
}

export function formatPricingFromFeeLines(feeLines: string[]): string {
  if (!feeLines.length) return "";
  return [
    "Published private fees (guide prices from the practice website):",
    ...feeLines,
    "Quote these figures when callers ask about price; say they are guide prices and may vary with clinical need.",
  ].join("\n");
}

export function mergePricingField(existing: string | undefined, feeLines: string[]): string {
  const formatted = formatPricingFromFeeLines(feeLines);
  if (!formatted) return (existing || "").trim();
  const current = (existing || "").trim();
  if (!current) return formatted;
  // Prefer the freshly scraped fee table when it has concrete £ figures.
  if (/£\d/.test(formatted) && (!/£\d/.test(current) || feeLines.length >= 3)) {
    return formatted;
  }
  if (/£\d/.test(current)) return current;
  return formatted;
}
