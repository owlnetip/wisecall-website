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

/**
 * Reply to use instead of the model while required details are missing.
 * Null means the visitor has not asked yet, or every required detail is in.
 */
export function requiredContactHoldReply(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
  messages: Array<{ role: string; content: string }>,
): string | null {
  const required = requiredContactFields(metadata);
  if (!required.length || !visitorHasAsked(messages)) return null;
  const missing = required.filter((field) => !hasContactField(collected, field));
  if (!missing.length) return null;

  const started = messages.some(
    (message) => message.role === "assistant" && message.content.includes(HOLD_MARK),
  );
  const question = ASK[missing[0]];
  const list = joinLabels(missing);
  if (!started) {
    return `Thanks, I can help with that. I'll need your ${list} before I can go any further. ${question}`;
  }
  return `I still need your ${list} before I can go any further. ${question}`;
}

export function contactDetailsCompleteNote(
  metadata: Record<string, unknown> | null | undefined,
  collected: Record<string, unknown>,
): string | null {
  const required = requiredContactFields(metadata);
  if (!required.length || !requiredContactSatisfied(metadata, collected)) return null;
  const phone = required.includes("phone") ? " Confirm the phone number once, then help them." : "";
  return `The visitor has given their ${joinLabels(required)}. Answer the enquiry they asked.${phone} Do not ask for those details again, and do not treat any of them as optional.`;
}
