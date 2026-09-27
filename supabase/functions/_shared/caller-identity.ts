/**
 * Prefer the name and company the caller confirmed or spelled over a model's
 * first guess. A first guess is how two people end up stored as one caller
 * ("Zamia Khan Jamal Rashid") and how a company name gets written down wrong.
 */

const NAME_BLOCK = new Set([
  "yes",
  "no",
  "hello",
  "hi",
  "the",
  "a",
  "an",
  "caller",
  "speaking",
  "that",
  "this",
  "your",
  "number",
  "callback",
  "just",
  "confirm",
  "from",
  "company",
  "i",
  "im",
  "its",
  "it",
  "ok",
  "okay",
  "thanks",
  "thank",
  "you",
  "please",
]);

const COMPANY_BLOCK = new Set([
  "the",
  "a",
  "an",
  "office",
  "home",
  "here",
  "there",
  "work",
  "you",
  "them",
  "me",
  "us",
  "yes",
  "no",
  "company",
  "business",
  "calling",
]);

function titleWord(word: string): string {
  if (!word) return "";
  if (word.length <= 2 && /^[A-Z]{1,2}$/.test(word)) return word;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

function lettersToWord(chars: string): string {
  const clean = chars.replace(/[^A-Za-z]/g, "");
  if (clean.length < 2) return "";
  return titleWord(clean);
}

function capWords(value: string, maxWords: number): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, maxWords)
    .map(titleWord)
    .join(" ")
    .trim();
}

export function stripSpeakerLabels(text: string): string {
  return text.replace(/\b(?:agent|assistant|caller|user|human|customer|wisecall)\s*:\s*/gi, " ");
}

function parseLetterGroups(fragment: string): string | null {
  const hyphenWords = [...fragment.matchAll(/\b([A-Za-z](?:-[A-Za-z]){1,})\b/g)]
    .map((match) => lettersToWord(match[1]))
    .filter((word) => word.length >= 2);
  if (hyphenWords.length) return hyphenWords.join(" ");

  const marked = fragment.replace(/\b(?:space|gap)\b/gi, "|");
  const words: string[] = [];
  for (const part of marked.split("|")) {
    const letters = [...part.matchAll(/\b([A-Za-z])\b/g)].map((match) => match[1]);
    if (letters.length >= 3) words.push(lettersToWord(letters.join("")));
  }
  return words.length ? words.join(" ") : null;
}

function windowsAfter(text: string, cue: RegExp, stop: RegExp, max = 90): string[] {
  const flags = cue.flags.includes("g") ? cue.flags : `${cue.flags}g`;
  const re = new RegExp(cue.source, flags);
  const windows: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    let slice = text.slice(match.index + match[0].length, match.index + match[0].length + max);
    const stopAt = slice.search(stop);
    if (stopAt >= 0) slice = slice.slice(0, stopAt);
    windows.push(slice);
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return windows;
}

export function extractSpelledName(text: string): string | null {
  const cues = windowsAfter(
    text,
    /\b(?:spell(?:ed|ing)?|spelt|name is|name's)\b/i,
    /\b(?:company|compan|callback|phone number)\b/i,
    160,
  );
  let best: string | null = null;
  for (const slice of cues) {
    const parsed = parseLetterGroups(slice);
    const named = parsed ? capWords(parsed, 3) : "";
    if (named && (!best || named.length > best.length)) best = named;
  }
  return best;
}

export function extractSpelledCompany(text: string): string | null {
  const cues = windowsAfter(
    text,
    /\b(?:company(?:\s+name)?|calling from|business name)\b/i,
    /\b(?:callback number|phone number|my name|who am i)\b/i,
    140,
  );
  let best: string | null = null;
  for (const slice of cues) {
    const parsed = parseLetterGroups(slice);
    const named = parsed ? capWords(parsed, 4) : "";
    if (named && (!best || named.length > best.length)) best = named;
  }
  return best;
}

export function cleanPersonName(raw: string): string | null {
  let value = raw.replace(/^(?:it'?s|this is|i am|i'm|my name is)\s+/i, "").trim();
  value = value.split(/\b(?:and|from|with|calling|about|here|at|on)\b|[,.!?;]/i)[0] ?? "";
  const words = value
    .trim()
    .split(/\s+/)
    .filter((word) => /^[A-Za-z][A-Za-z'’-]*$/.test(word))
    .filter((word) => !NAME_BLOCK.has(word.toLowerCase()));
  if (words.length < 1 || words.length > 3) return null;
  if (words.length === 1 && words[0].length < 2) return null;
  return words.slice(0, 3).map(titleWord).join(" ");
}

function extractReadbackName(text: string): string | null {
  const patterns = [
    /(?:just to confirm|i have you as|i'll put you down as|so i have)\b[\s\S]{0,80}?speaking with\s+([A-Za-z][^.\n]{1,40})/i,
    /(?:just to confirm[, ]+)(?:i'm speaking with\s+|i am speaking with\s+|that's\s+|that is\s+)?([A-Za-z][^.\n]{1,40})/i,
    /\bspeaking with\s+([A-Za-z][^.\n?]{1,40})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = match ? cleanPersonName(match[1]) : null;
    if (cleaned) return cleaned;
  }
  return null;
}

function extractNameAfterWho(text: string): string | null {
  const match = text.match(/who am i speaking with\??([\s\S]{0,80})/i);
  if (!match) return null;
  return cleanPersonName(match[1]);
}

function cleanCompanyName(raw: string): string | null {
  const value = raw.replace(/\s+/g, " ").trim().replace(/[.,!?;:]+$/g, "");
  if (!value || value.length < 2 || value.length > 80) return null;
  if (/^\+?\d[\d\s()-]{6,}$/.test(value)) return null;
  const words = value.split(/\s+/);
  if (words.every((word) => COMPANY_BLOCK.has(word.toLowerCase()))) return null;
  return value;
}

function extractReadbackCompany(text: string): string | null {
  const patterns = [
    /just to confirm[\s\S]{0,100}?\bfrom\s+([A-Za-z0-9][^.\n]{1,60})/i,
    /\bcompany(?:\s+name)?\s*(?:is|:)\s+([A-Za-z0-9][^.\n]{1,60})/i,
    /\bcalling from\s+([A-Za-z0-9][^.\n]{1,60})/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = match ? cleanCompanyName(match[1].split(/\b(?:about|regarding|and the|callback)\b/i)[0] ?? "") : null;
    if (cleaned) return cleaned;
  }
  return null;
}

export function preferConfirmedCallerName(
  modelName: string,
  ...parts: Array<string | null | undefined>
): string {
  const text = stripSpeakerLabels(parts.filter((part): part is string => Boolean(part?.trim())).join("\n"));
  const spelled = extractSpelledName(text);
  if (spelled) return spelled.slice(0, 80);
  const readback = extractReadbackName(text);
  if (readback) return readback.slice(0, 80);
  const asked = extractNameAfterWho(text);
  if (asked) return asked.slice(0, 80);
  return modelName.trim().slice(0, 80);
}

export function preferConfirmedCompany(
  modelCompany: string,
  ...parts: Array<string | null | undefined>
): string {
  const text = stripSpeakerLabels(parts.filter((part): part is string => Boolean(part?.trim())).join("\n"));
  const spelled = extractSpelledCompany(text);
  if (spelled) return spelled.slice(0, 80);
  const readback = extractReadbackCompany(text);
  if (readback) return readback.slice(0, 80);
  return modelCompany.trim().slice(0, 80);
}
