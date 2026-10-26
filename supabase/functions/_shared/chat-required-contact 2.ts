// When an agent sets metadata.live_chat_required_contact, website chat may
// greet someone and hear their question, then must collect those details
// before answering or handing the enquiry on. Phone is not optional.
// Adding "seller_address" to that list also requires the property address
// (with postcode) once the chat is known to be a seller enquiry.

import { bareNameReply } from "./chat-contact-name.ts";
import { detectEnquiryType } from "./chat-enquiry-type.ts";

export type RequiredContactField = "name" | "email" | "phone" | "address";

const ORDER: RequiredContactField[] = ["name", "email", "phone", "address"];

const KEY: Record<RequiredContactField, string> = {
  name: "contact_name",
  email: "contact_email",
  phone: "contact_phone",
  address: "property_address",
};

const LABEL: Record<RequiredContactField, string> = {
  name: "name",
  email: "email address",
  phone: "phone number",
  address: "property address and postcode",
};

// One friendly question at a time. Each ask is distinctive so we can tell the
// fixed-wording ask was already used (see alreadyAskedFor).
const ASK: Record<RequiredContactField, string> = {
  name: "Can I take your name first?",
  email: "What's the best email address for you?",
  phone: "What's the best phone number to reach you on?",
  address: "What's the address of the property you're selling, including the postcode?",
};

// Wording used before 1 Oct 2026, so chats already in progress at deploy time
// aren't asked the same thing twice.
const LEGACY_HOLD_MARK = "before I can go any further";
const LEGACY_ASK: Record<RequiredContactField, string> = {
  name: "What's your name?",
  email: "What's your email address?",
  phone: "What's the best phone number to reach you on?",
  address: "",
};

// Allows stray spaces people type, e.g. "en1 3 LP".
const UK_POSTCODE = /\b[A-Z]{1,2}\d[A-Z\d]?\s*\d\s?[A-Z]\s?[A-Z]\b/i;

export function hasPostcode(value: string): boolean {
  return UK_POSTCODE.test(value);
}

export function requiredContactFields(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown> = {},
): RequiredContactField[] {
  const raw = metadata?.live_chat_required_contact;
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw.map((value) => String(value)));
  if (wanted.has("seller_address") && collected.enquiry_type === "seller") wanted.add("address");
  return ORDER.filter((field) => wanted.has(field));
}

/** True when the agent's last message asked for the property address. */
export function agentAskedForPropertyAddress(lastAgentMessage: string): boolean {
  const text = String(lastAgentMessage || "");
  if (text.includes(ASK.address)) return true;
  return /\b(address|postcode)\b[^?]*\?/i.test(text) && /\b(property|house|home|flat|bungalow|selling)\b/i.test(text);
}

/**
 * The property address from a seller's message: their reply to the address
 * question, or any message that contains a UK postcode.
 */
export function extractPropertyAddress(message: string, lastAgentMessage: string): string | undefined {
  const text = String(message || "").replace(/\s+/g, " ").trim();
  if (!text || /^(no|nope|yes|ok|okay|thanks|thank you)\b[.!]*$/i.test(text)) return undefined;
  if (hasPostcode(text)) return text.slice(0, 200);
  if (agentAskedForPropertyAddress(lastAgentMessage) && /\d|\b(road|rd|street|st|lane|avenue|ave|close|drive|way|court|gardens|crescent|place|terrace|grove|hill|park|view|row|walk|mews|square)\b/i.test(text)) {
    return text.slice(0, 200);
  }
  return undefined;
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
  const required = requiredContactFields(metadata, collected);
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
      message.role === "assistant" && alreadyAskedForOne(message.content, field),
  );
}

function firstName(collected: Record<string, unknown>): string {
  const name = typeof collected.contact_name === "string" ? collected.contact_name.trim() : "";
  return name.split(/\s+/)[0] || "";
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
  const required = requiredContactFields(metadata, collected);
  if (!required.length || !visitorHasAsked(messages)) return null;
  const missing = required.filter((field) => !hasContactField(collected, field));
  if (!missing.length || alreadyAskedFor(messages, missing[0])) return null;

  const field = missing[0];
  const askedBefore = messages.some(
    (message) => message.role === "assistant" && ORDER.some((f) => alreadyAskedForOne(message.content, f)),
  );
  if (!askedBefore) return `Happy to help with that. ${ASK[field]}`;
  const name = firstName(collected);
  return `${name ? `Thanks, ${name}.` : "Thanks."} ${ASK[field]}`;
}

function alreadyAskedForOne(content: string, field: RequiredContactField): boolean {
  if (content.includes(ASK[field])) return true;
  const legacy = LEGACY_ASK[field];
  return Boolean(legacy) && content.includes(LEGACY_HOLD_MARK) && content.includes(legacy);
}

/** Extra system note for the model about the required details. */
export function requiredContactNote(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
  messages: Array<{ role: string; content: string }>,
): string | null {
  const required = requiredContactFields(metadata, collected);
  if (!required.length || !visitorHasAsked(messages)) return null;
  const enquiry = firstEnquiry(messages);
  const asked = enquiry ? ` Their enquiry was: "${enquiry}". Deal with that now; do not ask them to repeat it or ask what it is about.` : "";

  if (requiredContactSatisfied(metadata, collected)) {
    const phone = required.includes("phone") ? " Confirm the phone number once, then help them." : "";
    const address = String(collected.property_address || "");
    const postcode = required.includes("address") && address && !hasPostcode(address)
      ? ` The property address they gave ("${address}") has no postcode: ask for the postcode once, then carry on.`
      : "";
    return `The visitor has given their ${joinLabels(required)}.${asked}${phone}${postcode} Do not ask for those details again.`;
  }

  const missing = required.filter((field) => !hasContactField(collected, field));
  return [
    `Still missing: their ${joinLabels(missing)}.`,
    "Read their last message carefully first. If it already contains the detail in an unusual format (a space inside an email address, a number split up with spaces or dashes), take it as given, repeat it back once to confirm, and ask for the next missing detail. Never ask for something they have already typed.",
    "If what they typed is incomplete (a phone number that is too short, an email without the part after @), say exactly what looks wrong in a friendly way and ask them to check it.",
    "If they would rather not give the phone number, explain briefly that the team uses it to follow up quickly and ask again in different words. Never repeat a sentence you have already used in this chat.",
    ...(missing.includes("address")
      ? ["For a seller, the property address with its postcode is needed so the team can value it. Ask for the full address including the postcode; if they only give part of it, ask for the rest."]
      : []),
  ].join(" ") + asked;
}
