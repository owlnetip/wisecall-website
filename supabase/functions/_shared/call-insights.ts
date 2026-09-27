// Claude-written post-call insights for the team email and staff SMS.
//
// The runtime's own summary is a concatenation of speech fragments ("Caller Can
// I Speak To said: It's confidential.") and it echoes the calling line back as
// the caller's phone number. Inbound calls that arrive via a divert present the
// forwarding number, so the only number worth ringing back is the one the
// caller reads out. This asks Claude for both, and verifies the number was
// really spoken before it goes anywhere near the email.

const CLAUDE_MODEL = "claude-opus-5";

export type CallInsights = {
  summary: string;
  callerName: string;
  company: string;
  callbackNumber: string;
  urgency: string;
};

const SYSTEM_PROMPT = `You write the post-call note that a receptionist would leave for a colleague.

You are given the transcript of a call handled by an AI phone assistant. Reply with JSON only, no prose and no code fences:
{"summary":"","caller_name":"","company":"","callback_number":"","urgency":""}

summary: one to three plain sentences for whoever has to ring this person back. Who called, what they want, what was promised. Write it as a note, never as a list of quotes. If the caller hung up before saying anything useful, say exactly that.
caller_name: the caller's name as they gave it, e.g. "Alana Shaw". Empty string if they never gave one. Never put a fragment of the conversation here.
company: the company they said they were from, written as it was heard. Empty string if not mentioned. Never guess at a real company from a garbled name.
callback_number: the phone number the CALLER read out, digits only, e.g. "07967161428". Speech-to-text writes numbers as words, so convert them. Empty string unless the caller actually said a number. Never use a number the assistant read out.
urgency: "emergency", "urgent" or "routine".

Never invent a detail that is not in the transcript. An empty string is always better than a guess.`;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const DIGIT_WORDS: Record<string, string> = {
  zero: "0", oh: "0", o: "0", nought: "0", nil: "0",
  one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9",
};

/** Every digit spoken anywhere in the transcript, as one string. */
export function spokenDigits(transcript: string): string {
  const tokens = String(transcript || "")
    .toLowerCase()
    .replace(/[-–—]/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  let out = "";
  let repeat = 1;
  for (const token of tokens) {
    if (token === "double") { repeat = 2; continue; }
    if (token === "triple" || token === "treble") { repeat = 3; continue; }
    if (/^\d+$/.test(token)) {
      out += token.repeat(repeat);
      repeat = 1;
      continue;
    }
    const digit = DIGIT_WORDS[token];
    if (digit) {
      out += digit.repeat(repeat);
    }
    repeat = 1;
  }
  return out;
}

/** The candidate, but only if the caller really said those digits. */
export function verifiedCallbackNumber(candidate: string, transcript: string): string {
  const digits = String(candidate || "").replace(/\D/g, "");
  if (digits.length < 9) return "";
  const national = digits.length > 10 ? digits.slice(-10) : digits;
  const spoken = spokenDigits(transcript);
  // Match on the last 9, which survives a missed leading 0 or a spoken +44.
  if (!spoken.includes(national.slice(-9))) return "";
  if (national.length === 10 && !national.startsWith("0")) return `0${national}`;
  return national;
}

const NAME_STOPWORDS = new Set([
  "can", "i", "speak", "to", "please", "hello", "hi", "thanks", "thank", "you",
  "the", "a", "an", "and", "is", "it", "its", "confidential", "matter", "calling",
  "call", "unknown", "caller", "none", "null", "n/a",
]);

/** Guards against a conversation fragment arriving where a name should be. */
export function cleanName(value: unknown): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw || raw.length > 60) return "";
  const words = raw.split(" ");
  if (words.length > 4) return "";
  for (const word of words) {
    const bare = word.toLowerCase().replace(/[^a-z']/g, "");
    if (!bare) return "";
    if (NAME_STOPWORDS.has(bare)) return "";
  }
  return raw;
}

function cleanText(value: unknown, maxLength: number): string {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!raw || /^(none|null|n\/a|unknown|not given)$/i.test(raw)) return "";
  return raw.length > maxLength ? `${raw.slice(0, maxLength - 1).trim()}…` : raw;
}

function parseJsonBlock(text: string): Record<string, unknown> | null {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function askClaude(key: string, transcript: string, withEffort: boolean): Promise<Response> {
  const body: Record<string, unknown> = {
    model: CLAUDE_MODEL,
    max_tokens: 600,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Call transcript:\n\n${transcript}` }],
  };
  if (withEffort) body.output_config = { effort: "low" };

  return await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Null whenever anything at all goes wrong — no key, a bad response, junk JSON.
 * The caller keeps its existing summary, so the email always sends.
 */
export async function buildAiCallInsights(transcript: string): Promise<CallInsights | null> {
  const key = Deno.env.get("CLAUDE_API_WISECASE");
  const text = String(transcript || "").trim();
  if (!key || text.length < 40) return null;

  try {
    let res = await askClaude(key, text.slice(0, 20000), true);
    if (res.status === 400) {
      // Older API surface: retry without the effort hint rather than lose the note.
      console.warn("[call-insights] retrying without output_config:", (await res.text()).slice(0, 200));
      res = await askClaude(key, text.slice(0, 20000), false);
    }
    if (!res.ok) {
      console.error("[call-insights] claude:", res.status, (await res.text()).slice(0, 300));
      return null;
    }

    const data = await res.json();
    const block = (data.content || []).find((item: { type?: string }) => item?.type === "text");
    const parsed = parseJsonBlock(block?.text || "");
    if (!parsed) return null;

    const summary = cleanText(parsed.summary, 600);
    if (!summary) return null;

    const urgency = String(parsed.urgency ?? "").trim().toLowerCase();
    return {
      summary,
      callerName: cleanName(parsed.caller_name),
      company: cleanText(parsed.company, 80),
      callbackNumber: verifiedCallbackNumber(String(parsed.callback_number ?? ""), text),
      urgency: ["emergency", "urgent", "routine"].includes(urgency) ? urgency : "",
    };
  } catch (error) {
    console.error("[call-insights] failed:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
