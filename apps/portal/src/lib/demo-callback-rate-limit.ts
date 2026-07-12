import { createHash } from "node:crypto";

export const DEMO_CALLBACK_IP_LIMIT = 5;
export const DEMO_CALLBACK_IP_WINDOW_SECONDS = 15 * 60;
export const DEMO_CALLBACK_NUMBER_LIMIT = 3;
export const DEMO_CALLBACK_NUMBER_WINDOW_SECONDS = 60 * 60;

export function getCallbackClientIp(headers: Headers): string {
  const forwarded =
    headers.get("x-vercel-forwarded-for") ||
    headers.get("x-forwarded-for") ||
    headers.get("x-real-ip") ||
    "unknown";
  return forwarded.split(",")[0]?.trim().slice(0, 128) || "unknown";
}

export function normaliseCallbackNumber(value: string): string {
  let digits = value.trim().replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  return digits;
}

export function createCallbackRateLimitKey(kind: "ip" | "number", value: string): string {
  const digest = createHash("sha256").update(`${kind}:${value}`).digest("hex");
  return `${kind}:${digest}`;
}

export type CallbackRateLimitResult = {
  allowed: boolean;
  retryAfterSeconds: number;
};

export function readCallbackRateLimitResult(value: unknown): CallbackRateLimitResult | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.allowed !== "boolean" || typeof record.retry_after_seconds !== "number") return null;
  return {
    allowed: record.allowed,
    retryAfterSeconds: Math.max(1, Math.ceil(record.retry_after_seconds)),
  };
}
