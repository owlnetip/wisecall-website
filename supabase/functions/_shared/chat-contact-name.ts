// Pulls a visitor's name out of a chat message without mistaking the start of a
// sentence for one ("I am thinking of selling my house" is not a name).

const NOT_NAME_START = new Set([
  "a", "an", "the", "just", "not", "so", "also", "still", "really", "very", "quite", "currently", "looking",
  "thinking", "wondering", "trying", "hoping", "planning", "calling", "asking", "interested", "selling",
  "buying", "renting", "moving", "after", "ready", "sure", "happy", "keen", "unable", "able", "going",
  "gonna", "about", "from", "with", "in", "on", "at", "on", "here", "there", "back", "new", "your",
  "want", "wanting", "need", "needing", "having", "getting", "reporting", "reaching", "enquiring",
  "inquiring", "emailing", "messaging", "writing", "contacting", "the", "sorry", "fine", "good", "ok",
  "okay", "well", "yes", "no", "hi", "hello", "afraid", "glad", "pleased", "retired", "married",
  "single", "away", "busy", "free", "available", "outside", "inside", "over", "under",
]);

const STOP_WORDS = new Set([
  "and", "from", "of", "at", "with", "in", "on", "here", "calling", "and", "i", "im", "i'm", "my", "the",
  "a", "to", "about", "for", "re", "regarding", "looking", "want", "would", "please", "thanks", "thank",
  "email", "phone", "number", "mobile", "is", "it's", "its", "can", "could", "who", "that", "but",
]);

function candidateWords(raw: string): string[] {
  const words = raw.replace(/[.,;:!?()]+.*$/s, "").trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    if (STOP_WORDS.has(word.toLowerCase()) || !/^[a-z][a-z'-]*$/i.test(word)) break;
    out.push(word);
    if (out.length === 3) break;
  }
  return out;
}

// Keep the visitor's own capitalisation (McTestface); only fix all-lower-case input.
function titleCase(word: string): string {
  if (word !== word.toLowerCase()) return word;
  return word.replace(/(^|[-'])([a-z])/g, (_m, sep, ch) => sep + ch.toUpperCase());
}

export function extractChatName(text: string): string | undefined {
  // Explicit "my name is" beats everything; case-insensitive.
  const explicit = text.match(/\b(?:my name is|my name's|name is|name's|call me)\s+([a-z][a-z' -]{1,60})/i);
  if (explicit) {
    const words = candidateWords(explicit[1]);
    if (words.length && !NOT_NAME_START.has(words[0].toLowerCase())) return words.map(titleCase).join(" ");
  }

  // "I am / I'm / this is X": only when X reads like a name, not a sentence.
  for (const match of text.matchAll(/\b(?:i am|i'm|im|this is|it's|its)\s+([a-z][a-z' -]{1,60})/gi)) {
    const words = candidateWords(match[1]);
    if (!words.length) continue;
    const first = words[0].toLowerCase();
    if (NOT_NAME_START.has(first) || /(ing|ed|ly)$/.test(first)) continue;
    // Lower-case after "I'm" is usually a word, not a name ("i'm fine", "i'm moving").
    if (!/^[A-Z]/.test(words[0])) continue;
    return words.map(titleCase).join(" ");
  }
  return undefined;
}

/**
 * The visitor's reply straight after the agent asked for their name
 * ("What's your name?" → "Sam Route"). Only accepts 1-3 name-like words.
 */
export function bareNameReply(message: string): string | undefined {
  const text = String(message || "").trim().replace(/[.!]+$/, "");
  if (!/^[A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2}$/.test(text)) return undefined;
  const words = text.split(/\s+/);
  const first = words[0].toLowerCase();
  if (NOT_NAME_START.has(first) || STOP_WORDS.has(first)) return undefined;
  if (/^(yes|yeah|yep|no|nope|ok|okay|thanks|thank|hi|hello|hey|sure|fine|selling|buying|sell|buy|general)$/i.test(text)) return undefined;
  return words.map(titleCase).join(" ");
}

export function agentAskedForName(lastAgentMessage: string): boolean {
  return /\b(your (full )?name|who am i speaking|may i (take|have) your name|can i (take|get|have) your name)\b/i.test(String(lastAgentMessage || ""));
}
