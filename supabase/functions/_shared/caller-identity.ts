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

export type CompanyStatus = "confirmed" | "unconfirmed" | "none";

export type CompanyCapture = {
  company: string;
  company_status: CompanyStatus;
};

const SPEAKER_SPLIT =
  /(?:^|\n)\s*(agent|assistant|caller|user|human|customer|wisecall|receptionist)\s*:\s*/gi;

function parseTurns(text: string): Array<{ speaker: "agent" | "caller"; text: string }> {
  const marks: Array<{ speaker: "agent" | "caller"; end: number; index: number }> = [];
  const re = new RegExp(SPEAKER_SPLIT.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const label = match[1].toLowerCase();
    const speaker =
      label === "caller" || label === "user" || label === "human" || label === "customer"
        ? "caller"
        : "agent";
    marks.push({ speaker, index: match.index, end: re.lastIndex });
    if (re.lastIndex === match.index) re.lastIndex += 1;
  }
  return marks.flatMap((mark, index) => {
    const end = index + 1 < marks.length ? marks[index + 1].index : text.length;
    const body = text.slice(mark.end, end).trim();
    return body ? [{ speaker: mark.speaker, text: body }] : [];
  });
}

function sameCompany(a: string, b: string): boolean {
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const left = norm(a);
  const right = norm(b);
  return left.length >= 2 && left === right;
}

function isPersonalCall(text: string): boolean {
  const t = text.toLowerCase();
  if (/\b(?:no company|not from a company|not calling from a company|don'?t have a company|do not have a company|without a company|haven'?t got a company|no business name)\b/.test(t)) {
    return true;
  }
  if (/\b(?:calling personally|personal call|it(?:'s| is) (?:a )?personal|private individual|not a (?:company|business)|on my own behalf)\b/.test(t)) {
    return true;
  }
  return /\bjust (?:me|myself)\b/.test(t) && /\b(?:no company|personally|personal)\b/.test(t);
}

function isAffirmation(text: string): boolean {
  const t = text.trim().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
  if (!t || /\b(?:no|nope|wrong|incorrect|actually|meant)\b/i.test(t)) return false;
  return /^(?:yes|yeah|yep|yup|correct|that's right|thats right|that's correct|thats correct|that is correct|that is right|all correct|that's all correct|that is all correct|confirmed|perfect|exactly)(?:[, ]+(?:please|thanks|thank you|it is|that's right|thats right|that's correct|thats correct|that is correct))*$/i.test(t);
}

function isBareRejection(text: string): boolean {
  const t = text.trim().replace(/[.!]+$/g, "").replace(/\s+/g, " ");
  return /^(?:no|nope|that's wrong|thats wrong|that is wrong|incorrect|not quite|that's not right|thats not right|that is not right|that's incorrect|thats incorrect)$/i.test(t);
}

function isConfirmationAsk(text: string): boolean {
  return /\b(?:is that (?:right|correct|all correct)|is this (?:right|correct)|is that all correct|did i get that right|have i got that right)\b/i.test(text);
}

function asksForCompany(text: string): boolean {
  return /\b(?:which company|what company|company are you|name of (?:the |your )?company|your company name|business name|spell (?:the |your )?company)\b/i.test(text);
}

function asksToSpellName(text: string): boolean {
  return /\bspell(?:ed|ing)?\b/i.test(text) && /\bname\b/i.test(text) && !/\bcompany\b/i.test(text);
}

function companyFromPhrase(raw: string): string | null {
  const cut = (raw.split(/\b(?:and the|and i(?:'ll| will)|and we|is that|is this|about|regarding|callback|phone number|my number)\b/i)[0] ?? "")
    .replace(/[.,!?;:]+$/g, "")
    .trim();
  if (/^\+?\d/.test(cut)) return null;
  return cleanCompanyName(cut);
}

function parseCompanySpelling(text: string): string | null {
  const parsed = parseLetterGroups(text);
  if (!parsed) return null;
  return capWords(parsed, 4) || null;
}

function spokenCompanyFromCaller(text: string): string | null {
  if (isPersonalCall(text) || isAffirmation(text) || isBareRejection(text)) return null;
  const withoutLetters = text
    .replace(/\b[A-Za-z](?:-[A-Za-z]){1,}\b/g, " ")
    .replace(/\b(?:space|gap)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutLetters) return null;
  const lead = withoutLetters.match(
    /^(?:no[, ]+)?(?:it(?:'s| is)|i meant|i work (?:for|at)|i(?:'m| am) (?:calling from|from|with|at)|we(?:'re| are) (?:from|with|at)|calling from|the company is|company is)\s+(.+)$/i,
  );
  const candidate = (lead ? lead[1] : withoutLetters).split(/[.]|\b(?:please|thanks|thank you)\b/i)[0]?.trim() ?? "";
  if (!lead) {
    if (/[?]/.test(text) || /^(?:i|we|my|please|can|could|would|sorry)\b/i.test(withoutLetters)) return null;
    if (candidate.split(/\s+/).length > 6) return null;
  }
  return cleanCompanyName(candidate);
}

function extractCompanyFromReadback(text: string, immediate: boolean): string | null {
  const spelled = parseCompanySpelling(text);
  if (spelled && (immediate || /\bcompany\b/i.test(text))) return spelled;
  const from = text.match(/\bfrom\s+([A-Za-z0-9][^?.!\n]{1,80})/i);
  if (from && !/\bfrom\s+(?:the number|this number|that number|\+?\d)/i.test(from[0])) {
    const company = companyFromPhrase(from[1]);
    if (company) return company;
  }
  const named = text.match(/\bcompany(?:\s+name)?\s*(?:is|:)\s+([A-Za-z0-9][^?.!\n]{1,80})/i);
  if (named) {
    const company = companyFromPhrase(named[1]);
    if (company) return company;
  }
  if (!immediate || (/\bspeaking with\b/i.test(text) && !/\bfrom\b/i.test(text))) return null;
  const thats = text.match(/\b(?:that(?:'s| is)|i have(?: you)?(?: down)? as|so i have)\s+([A-Za-z0-9][^?.!\n]{1,80})/i);
  if (thats && !/\bspeaking with\b/i.test(thats[0])) {
    const company = companyFromPhrase(thats[1]);
    if (company) return company;
  }
  const leading = (text.split(/\b(?:is that|is this|did i|have i)\b/i)[0] ?? "")
    .replace(/^.*\b(?:that(?:'s| is)|so i have|i have you as|from|company(?:\s+name)?\s*(?:is|:))\s+/i, "");
  const company = companyFromPhrase(leading);
  if (!company || company.split(/\s+/).length > 6) return null;
  return company;
}

function groundedModelCompany(modelCompany: string, text: string): string {
  const trimmed = modelCompany.trim().slice(0, 80);
  if (trimmed.length < 2) return "";
  if (!text.toLowerCase().includes(trimmed.toLowerCase())) return "";
  return cleanCompanyName(trimmed) ?? "";
}

function captureCompanyFromTranscript(text: string): CompanyCapture {
  const turns = parseTurns(text);
  if (!turns.length) return captureUnlabelledCompany(text);

  let companyContext = false;
  let nameSpellNext = false;
  let awaitReadback = false;
  let spelled: string | null = null;
  let heard: string | null = null;
  let pending: string | null = null;
  let confirmed: string | null = null;
  let personal = false;

  for (const turn of turns) {
    if (turn.speaker === "agent") {
      if (asksToSpellName(turn.text)) nameSpellNext = true;
      if (asksForCompany(turn.text) || (/\bspell that\b/i.test(turn.text) && companyContext)) {
        companyContext = true;
        nameSpellNext = false;
      }
      if (isConfirmationAsk(turn.text)) {
        const readback = extractCompanyFromReadback(turn.text, awaitReadback);
        if (readback) pending = readback;
      }
      awaitReadback = false;
      continue;
    }

    const spelledNow = !nameSpellNext && companyContext ? parseCompanySpelling(turn.text) : null;
    const offersCompany = /\b(?:calling from|company is|i work (?:for|at))\b/i.test(turn.text);
    const spokenNow =
      !nameSpellNext && (companyContext || offersCompany) ? spokenCompanyFromCaller(turn.text) : null;
    if (nameSpellNext) nameSpellNext = false;

    if (isPersonalCall(turn.text) && !spelledNow && !spokenNow) {
      personal = true;
      spelled = null;
      heard = null;
      confirmed = null;
      pending = null;
      awaitReadback = false;
      continue;
    }

    if (spelledNow || spokenNow) {
      if (spelledNow) spelled = spelledNow;
      if (spokenNow) heard = spokenNow;
      personal = false;
      confirmed = null;
      pending = null;
      awaitReadback = true;
      companyContext = true;
      continue;
    }

    if (isAffirmation(turn.text) && pending) {
      confirmed = spelled && sameCompany(spelled, pending) ? spelled : pending;
      pending = null;
      personal = false;
      continue;
    }

    if (isBareRejection(turn.text) && pending) {
      if (heard && sameCompany(heard, pending)) heard = null;
      if (spelled && sameCompany(spelled, pending)) spelled = null;
      if (confirmed && sameCompany(confirmed, pending)) confirmed = null;
      pending = null;
    }
  }

  if (confirmed) return { company: confirmed.slice(0, 80), company_status: "confirmed" };
  if (personal && !spelled && !heard) return { company: "", company_status: "none" };
  const guess = (spelled || heard || "").slice(0, 80);
  return { company: guess, company_status: "unconfirmed" };
}

function captureUnlabelledCompany(text: string): CompanyCapture {
  if (isPersonalCall(text) && !parseCompanySpelling(text)) {
    return { company: "", company_status: "none" };
  }
  const spelled = extractSpelledCompany(text);
  const readback = extractReadbackCompany(text);
  const affirmed = isConfirmationAsk(text) && /\b(?:yes|that's correct|that is correct|that's right|thats right)\b/i.test(text);
  if (affirmed && (spelled || readback)) {
    const company = spelled && readback && sameCompany(spelled, readback) ? spelled : spelled || readback || "";
    return { company: company.slice(0, 80), company_status: "confirmed" };
  }
  return { company: (spelled || "").slice(0, 80), company_status: "unconfirmed" };
}

export function resolveCompanyCapture(
  modelCompany: string,
  ...parts: Array<string | null | undefined>
): CompanyCapture {
  const text = parts.filter((part): part is string => Boolean(part?.trim())).join("\n");
  const capture = captureCompanyFromTranscript(text);
  if (capture.company_status === "confirmed" || capture.company_status === "none") {
    return capture;
  }
  const guess = capture.company || groundedModelCompany(modelCompany, text);
  return { company: guess.slice(0, 80), company_status: "unconfirmed" };
}

export function preferConfirmedCompany(
  modelCompany: string,
  ...parts: Array<string | null | undefined>
): string {
  return resolveCompanyCapture(modelCompany, ...parts).company;
}

export function presentCompany(input: {
  company?: string | null;
  companyStatus?: string | null;
  transcript?: string | null;
  summary?: string | null;
}): { visible: boolean; text: string } {
  const stored = (input.company ?? "").trim();
  const status = (input.companyStatus ?? "").trim().toLowerCase();
  if (status === "confirmed") {
    return stored
      ? { visible: true, text: stored }
      : { visible: true, text: "Company not confirmed" };
  }
  if (status === "none") return { visible: true, text: "No company" };
  if (status === "unconfirmed") {
    return stored
      ? { visible: true, text: `${stored} (not confirmed)` }
      : { visible: true, text: "Company not confirmed" };
  }

  const text = [input.transcript, input.summary].filter((part) => part?.trim()).join("\n");
  if (text.trim()) {
    const resolved = resolveCompanyCapture(stored, text);
    if (resolved.company_status === "confirmed" && resolved.company) {
      return { visible: true, text: resolved.company };
    }
    if (resolved.company_status === "none") return { visible: true, text: "No company" };
    if (resolved.company) return { visible: true, text: `${resolved.company} (not confirmed)` };
  }
  if (stored) return { visible: true, text: `${stored} (not confirmed)` };
  return { visible: false, text: "" };
}
