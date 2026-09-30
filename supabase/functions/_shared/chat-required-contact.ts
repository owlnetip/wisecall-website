// When an agent sets metadata.live_chat_required_contact, website chat may
// greet someone and hear their question, then must collect those details
// before answering or handing the enquiry on. Phone is not optional.

import { bareNameReply } from "./chat-contact-name.ts";
import { detectEnquiryType } from "./chat-enquiry-type.ts";

export type RequiredContactField = "name" | "email" | "phone";

const ORDER: RequiredContactField[] = ["name", "email", "phone"];

const KEY: Record<RequiredContactField, string> = {
  name: "contact_name",
  email: "contact_email",
  phone: "contact_phone",
};

const LABEL: Record<RequiredContactField, string> = {
  name: "name",
  email: "email address",
  phone: "phone number",
};

const ASK: Record<RequiredContactField, string> = {
  name: "What's your name?",
  email: "What's your email address?",
  phone: "What's the best phone number to reach you on?",
};

const HOLD_MARK = "before I can go any further";

export function requiredContactFields(
  metadata: Record<string, unknown> | null | undefined,
): RequiredContactField[] {
  const raw = metadata?.live_chat_required_contact;
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.map((value) => String(value)));
  return ORDER.filter((field) => wanted.has(field));
}

export function hasContactField(
  collected: Record<string, unknown>,
  field: RequiredContactField,
): boolean {
  const value = collected[KEY[field]];
  return typeof value === "string" && value.trim().length > 0;
}

export function requiredContactSatisfied(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
): boolean {
  const required = requiredContactFields(metadata);
  return required.every((field) => hasContactField(collected, field));
}

function isTrivial(value: string): boolean {
  const text = value.trim().toLowerCase();
  if (!text) return true;
  return /^(hi|hello|hiya|hey|yes|yeah|yep|no|nope|ok|okay|thanks|thank you|test|testing)$/.test(text);
}

function isContactOnly(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (bareNameReply(text)) return true;
  if (/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(text)) return true;
  const compact = text.replace(/[\s().-]/g, "");
  return /^(?:\+44|0)\d{9,12}$/.test(compact);
}

/** A real enquiry, not a greeting or a bare name, email, or phone. */
export function messageIsEnquiry(value: string): boolean {
  const text = value.trim();
  if (!text || isTrivial(text) || isContactOnly(text)) return false;
  if (text.includes("?")) return true;
  if (detectEnquiryType(text)) return true;
  return text.split(/\s+/).filter(Boolean).length >= 3;
}

export function visitorHasAsked(messages: Array<{ role: string; content: string }>): boolean {
  return messages.some((message) => message.role === "user" && messageIsEnquiry(message.content));
}

function joinLabels(fields: RequiredContactField[]): string {
  const labels = fields.map((field) => LABEL[field]);
  if (labels.length <= 1) return labels[0] || "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** The visitor's first real question, so it can be answered once details are in. */
export function firstEnquiry(messages: Array<{ role: string; content: string }>): string | null {
  const found = messages.find((message) => message.role === "user" && messageIsEnquiry(message.content));
  return found ? found.content.trim().slice(0, 400) : null;
}

function alreadyAskedFor(
  messages: Array<{ role: string; content: string }>,
  field: RequiredContactField,
): boolean {
  return messages.some(
    (message) =>
      message.role === "assistant" && message.content.includes(HOLD_MARK) && message.content.includes(ASK[field]),
  );
}

/**
 * Fixed-wording ask to use instead of the model while required details are missing.
 * Each detail is asked this way once. If the visitor's answer didn't register
 * (odd formatting, a partial number, a refusal), repeating the same line makes
 * them type it again and again, so the model takes over with a note instead.
 * Null means: let the model reply.
 */
export function requiredContactHoldReply(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
  messages: Array<{ role: string; content: string }>,
): string | null {
  const required = requiredContactFields(metadata);
  if (!required.length || !visitorHasAsked(messages)) return null;
  const missing = required.filter((field) => !hasContactField(collected, field));
  if (!missing.length || alreadyAskedFor(messages, missing[0])) return null;

  const started = messages.some(
    (message) => message.role === "assistant" && message.content.includes(HOLD_MARK),
  );
  const question = ASK[missing[0]];
  const list = joinLabels(missing);
  if (!started) {
    return `Thanks, I can help with that. I'll need your ${list} before I can go any further. ${question}`;
  }
  return `Thanks. I'll just need your ${list} before I can go any further. ${question}`;
}

/** Extra system note for the model about the required details. */
export function requiredContactNote(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
  messages: Array<{ role: string; content: string }>,
): string | null {
  const required = requiredContactFields(metadata);
  if (!required.length || !visitorHasAsked(messages)) return null;
  const enquiry = firstEnquiry(messages);
  const asked = enquiry ? ` Their enquiry was: "${enquiry}". Deal with that now; do not ask them to repeat it or ask what it is about.` : "";

  if (requiredContactSatisfied(metadata, collected)) {
    const phone = required.includes("phone") ? " Confirm the phone number once, then help them." : "";
    return `The visitor has given their ${joinLabels(required)}.${asked}${phone} Do not ask for those details again.`;
  }

  const missing = required.filter((field) => !hasContactField(collected, field));
  return [
    `Still missing: their ${joinLabels(missing)}.`,
    "Read their last message carefully first. If it already contains the detail in an unusual format (a space inside an email address, a number split up with spaces or dashes), take it as given, repeat it back once to confirm, and ask for the next missing detail. Never ask for something they have already typed.",
    "If what they typed is incomplete (a phone number that is too short, an email without the part after @), say exactly what looks wrong in a friendly way and ask them to check it.",
    "If they would rather not give the phone number, explain briefly that the team uses it to follow up quickly and ask again in different words. Never repeat a sentence you have already used in this chat.",
  ].join(" ") + asked;
}
