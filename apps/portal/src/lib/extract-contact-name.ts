// Heuristic extraction of a caller's name from call transcripts and AI summaries.
// Used when wisecall_contacts.name is empty but past calls captured it in text.

const BLOCKLIST = new Set([
  "unknown",
  "caller",
  "customer",
  "client",
  "guest",
  "team",
  "survey",
  "quote",
  "enquiry",
  "inquiry",
  "appointment",
  "booking",
  "there",
  "hello",
  "hi",
  "yes",
  "no",
  "thanks",
  "thank",
  "you",
  "sir",
  "madam",
  "miss",
  "mr",
  "mrs",
  "ms",
  "dr",
]);

function cleanCandidate(raw: string): string | null {
  let name = raw
    .replace(/['"]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  // Drop trailing punctuation / filler
  name = name.replace(/[.,!?;:]+$/g, "").trim();
  if (!name) return null;

  const lower = name.toLowerCase();
  if (BLOCKLIST.has(lower)) return null;
  if (/^\+?\d[\d\s()-]{6,}$/.test(name)) return null;
  if (name.length < 2 || name.length > 48) return null;
  if (!/[a-zA-Z]/.test(name)) return null;

  // Title-case each word (preserve McDonald-ish simply)
  name = name
    .split(" ")
    .map((word) => {
      if (!word) return "";
      if (word.length <= 2 && /^[A-Z]{1,2}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();

  const words = name.split(/\s+/);
  if (words.every((w) => BLOCKLIST.has(w.toLowerCase()))) return null;

  return name;
}

const PATTERNS: RegExp[] = [
  /\bmy name(?:'s| is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
  /\bi(?:'m| am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s+(?:calling|and|from|here|speaking))?/i,
  /\bthis is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s+(?:calling|from|speaking))?/i,
  /\b(?:caller|customer|client)(?:'s|)\s+name(?: is|:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
  /\bname(?: is|:)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
  /\b(?:called|calling)\s+(?:from\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i,
  /\b(?:spoke with|speaking to|talked to)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/i,
  /\bCaller:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
  /\bCustomer:\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/,
  /\b(?:identified as|gave name as|provided name)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i,
  /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\s+called\b/,
  /\bCall from\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/,
];

function extractFromText(text: string): string | null {
  if (!text?.trim()) return null;

  for (const pattern of PATTERNS) {
    const match = text.match(pattern);
    if (match?.[1]) {
      const cleaned = cleanCandidate(match[1]);
      if (cleaned) return cleaned;
    }
  }

  return null;
}

/** Best-effort name from one call's summary + transcript (newest sources first). */
export function extractContactNameFromCall(input: {
  summary?: string | null;
  transcript?: string | null;
}): string | null {
  const fromSummary = extractFromText(input.summary ?? "");
  if (fromSummary) return fromSummary;

  const transcript = input.transcript ?? "";
  if (!transcript.trim()) return null;

  // Try full transcript, then caller-labelled lines
  const fromFull = extractFromText(transcript);
  if (fromFull) return fromFull;

  const callerLines = transcript
    .split(/\n/)
    .filter((line) => /^(caller|customer|user|them|visitor)\s*:/i.test(line.trim()));

  for (const line of callerLines) {
    const content = line.replace(/^[^:]+:\s*/i, "");
    const fromLine = extractFromText(content) ?? cleanCandidate(content.split(/[.!?]/)[0] ?? "");
    if (fromLine) return fromLine;
  }

  return null;
}

/** Pick the best name from multiple call logs (most recent match wins). */
export function extractContactNameFromLogs(
  logs: { summary?: string | null; transcript?: string | null; startedAt?: string }[],
): string | null {
  const sorted = [...logs].sort(
    (a, b) => Date.parse(b.startedAt ?? "") - Date.parse(a.startedAt ?? ""),
  );

  for (const log of sorted) {
    const name = extractContactNameFromCall(log);
    if (name) return name;
  }
  return null;
}
