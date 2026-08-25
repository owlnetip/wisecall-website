import { createHash } from "node:crypto";
import {
  getCallbackClientIp,
  readCallbackRateLimitResult,
  type CallbackRateLimitResult,
} from "./demo-callback-rate-limit";

export const GUEST_WIZARD_DRAFT_LIMIT = 6;
export const GUEST_WIZARD_VOICE_LIMIT = 12;
export const GUEST_WIZARD_WINDOW_SECONDS = 15 * 60;

export type GuestWizardRateKind = "draft" | "voice";

export function createGuestWizardRateLimitKey(
  kind: GuestWizardRateKind,
  ip: string,
): string {
  const digest = createHash("sha256").update(`guest-wizard:${kind}:${ip}`).digest("hex");
  return `guest-wizard:${kind}:${digest}`;
}

export function guestWizardRateLimitFor(kind: GuestWizardRateKind): {
  limit: number;
  windowSeconds: number;
} {
  return {
    limit: kind === "voice" ? GUEST_WIZARD_VOICE_LIMIT : GUEST_WIZARD_DRAFT_LIMIT,
    windowSeconds: GUEST_WIZARD_WINDOW_SECONDS,
  };
}

export function guestWizardClientIp(headers: { get(name: string): string | null }): string {
  return getCallbackClientIp(headers);
}

export function readGuestWizardRateLimitResult(value: unknown): CallbackRateLimitResult | null {
  return readCallbackRateLimitResult(value);
}

export function guestWizardRateLimitError(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `That was a lot of tries from this network. Wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`;
}
