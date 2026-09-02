import { NextResponse } from "next/server";
import {
  createCallbackRateLimitKey,
  DEMO_CALLBACK_IP_LIMIT,
  DEMO_CALLBACK_IP_WINDOW_SECONDS,
  DEMO_CALLBACK_NUMBER_LIMIT,
  DEMO_CALLBACK_NUMBER_WINDOW_SECONDS,
  getCallbackClientIp,
  normaliseCallbackNumber,
  readCallbackRateLimitResult,
} from "@/lib/demo-callback-rate-limit";
import { getDemoCallbackEndpoint } from "@/lib/env";
import { AVA_DEMO_SLUG } from "@/lib/guest-test-agent";
import { getServiceSupabase } from "@/lib/supabase";

export const AVA_DEMO_AGENT_NAME = "WiseCall Website Assistant";

export type PlaceDemoCallbackInput = {
  phone: string;
  source: string;
  headers: { get(name: string): string | null };
  /** When set, used as the IP limiter identity instead of the request IP. */
  rateLimitIp?: string;
};

export type PlaceDemoCallbackResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number; retryAfterSeconds?: number };

export function avaDemoCallbackBody(phone: string, source: string) {
  return {
    phone,
    // Same live demo as wisecall.io tap-to-call: +44 113 522 2277.
    profile_slug: AVA_DEMO_SLUG,
    agent_name: AVA_DEMO_AGENT_NAME,
    source,
  };
}

export async function placeAvaDemoCallback(
  input: PlaceDemoCallbackInput,
): Promise<PlaceDemoCallbackResult> {
  const service = getServiceSupabase();
  if (!service) {
    return {
      ok: false,
      status: 503,
      error: "Demo calls are temporarily unavailable. Please try again shortly.",
    };
  }

  const ipIdentity = input.rateLimitIp || getCallbackClientIp(input.headers);
  const ipKey = createCallbackRateLimitKey("ip", ipIdentity);
  const numberKey = createCallbackRateLimitKey("number", normaliseCallbackNumber(input.phone));
  const [ipLimitResponse, numberLimitResponse] = await Promise.all([
    service.rpc("wisecall_consume_demo_callback_rate_limit", {
      p_rate_key: ipKey,
      p_limit: DEMO_CALLBACK_IP_LIMIT,
      p_window_seconds: DEMO_CALLBACK_IP_WINDOW_SECONDS,
    }),
    service.rpc("wisecall_consume_demo_callback_rate_limit", {
      p_rate_key: numberKey,
      p_limit: DEMO_CALLBACK_NUMBER_LIMIT,
      p_window_seconds: DEMO_CALLBACK_NUMBER_WINDOW_SECONDS,
    }),
  ]);

  if (ipLimitResponse.error || numberLimitResponse.error) {
    console.error("Demo callback rate limit failed", {
      ip: ipLimitResponse.error?.message,
      number: numberLimitResponse.error?.message,
    });
    return {
      ok: false,
      status: 503,
      error: "Demo calls are temporarily unavailable. Please try again shortly.",
    };
  }

  const ipLimit = readCallbackRateLimitResult(ipLimitResponse.data);
  const numberLimit = readCallbackRateLimitResult(numberLimitResponse.data);
  if (!ipLimit || !numberLimit) {
    console.error("Demo callback rate limit returned an invalid response");
    return {
      ok: false,
      status: 503,
      error: "Demo calls are temporarily unavailable. Please try again shortly.",
    };
  }

  if (!ipLimit.allowed || !numberLimit.allowed) {
    const retryAfterSeconds = Math.max(
      ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
      numberLimit.allowed ? 0 : numberLimit.retryAfterSeconds,
    );
    return {
      ok: false,
      status: 429,
      retryAfterSeconds,
      error: "Too many demo calls have been requested. Please wait before trying again.",
    };
  }

  const response = await fetch(getDemoCallbackEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(avaDemoCallbackBody(input.phone, input.source)),
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.ok === false) {
    return {
      ok: false,
      status: response.status || 502,
      error: result.error || "Could not start the demo call.",
    };
  }

  return {
    ok: true,
    message: result.message || "The WiseCall demo agent is calling now.",
  };
}

export function demoCallbackHttpResponse(result: PlaceDemoCallbackResult) {
  if (result.ok) {
    return NextResponse.json({
      ok: true,
      message: result.message,
    });
  }

  const headers =
    result.status === 429 && result.retryAfterSeconds
      ? { "Retry-After": String(result.retryAfterSeconds) }
      : undefined;

  return NextResponse.json(
    { ok: false, error: result.error },
    { status: result.status, headers },
  );
}
