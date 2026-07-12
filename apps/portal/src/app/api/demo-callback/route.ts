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
import { getServiceSupabase } from "@/lib/supabase";
import { callbackSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = callbackSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message || "Invalid callback request.",
        },
        { status: 400 },
      );
    }

    const service = getServiceSupabase();
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Demo calls are temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    const ipKey = createCallbackRateLimitKey("ip", getCallbackClientIp(request.headers));
    const numberKey = createCallbackRateLimitKey("number", normaliseCallbackNumber(parsed.data.phone));
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
      return NextResponse.json(
        { ok: false, error: "Demo calls are temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    const ipLimit = readCallbackRateLimitResult(ipLimitResponse.data);
    const numberLimit = readCallbackRateLimitResult(numberLimitResponse.data);
    if (!ipLimit || !numberLimit) {
      console.error("Demo callback rate limit returned an invalid response");
      return NextResponse.json(
        { ok: false, error: "Demo calls are temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    if (!ipLimit.allowed || !numberLimit.allowed) {
      const retryAfterSeconds = Math.max(
        ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
        numberLimit.allowed ? 0 : numberLimit.retryAfterSeconds,
      );
      return NextResponse.json(
        {
          ok: false,
          error: "Too many demo calls have been requested. Please wait before trying again.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      );
    }

    const response = await fetch(getDemoCallbackEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: parsed.data.phone,
        profile_slug: "wisecall",
        agent_name: "WiseCall Website Assistant",
        source: parsed.data.source,
      }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "Could not start the demo call.",
        },
        { status: response.status || 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message || "The WiseCall demo agent is calling now.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not start the demo call.",
      },
      { status: 500 },
    );
  }
}
