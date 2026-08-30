import { toE164UkMobile } from "./uk-callback-number";

// Auto-dial the Facebook /setup visitor once the guest agent is ready and they
// have already given a UK mobile. Never fire on an empty or incomplete number.

export function guestAutoRingKey(phone: string, scannedWebsite: string): string | null {
  const e164 = toE164UkMobile(phone);
  const site = scannedWebsite.trim();
  if (!e164 || !site) return null;
  return `${e164}:${site}`;
}

export const AVA_AUTO_RING_KEY = "ava";

export function avaAutoRingKey(phone: string): string | null {
  const e164 = toE164UkMobile(phone);
  if (!e164) return null;
  return `${e164}:${AVA_AUTO_RING_KEY}`;
}

export function shouldAutoRingGuest(opts: {
  callPlaced: boolean;
  ringing: boolean;
  draftReady: boolean;
  website: string;
  scannedWebsite: string;
  phone: string;
}): boolean {
  if (opts.callPlaced || opts.ringing) return false;
  if (!opts.draftReady) return false;
  if (opts.website.trim() !== opts.scannedWebsite.trim()) return false;
  return Boolean(toE164UkMobile(opts.phone));
}

export function shouldAutoRingAva(opts: {
  callPlaced: boolean;
  ringing: boolean;
  phone: string;
}): boolean {
  if (opts.callPlaced || opts.ringing) return false;
  return Boolean(toE164UkMobile(opts.phone));
}

export function parseSetupPhone(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = input.trim().slice(0, 24);
  return toE164UkMobile(raw) ? raw : "";
}

export function parseSetupEmail(input: unknown): string {
  if (typeof input !== "string") return "";
  const raw = input.trim().slice(0, 200);
  if (!raw || !raw.includes("@") || !raw.includes(".")) return "";
  return raw;
}
