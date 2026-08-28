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
import {
  buildGuestTestAgentInsert,
  guestTestAgentSlug,
  guestTestCallbackBody,
  guestTestVoiceName,
} from "@/lib/guest-test-agent";
import { getServiceSupabase } from "@/lib/supabase";
import { toE164UkMobile } from "@/lib/uk-callback-number";
import { resolveVoiceRuntime } from "@/lib/voice-runtime";
import { parseWizardDraft } from "@/lib/wizard-draft";

function readDraft(value: unknown) {
  if (typeof value === "string") return parseWizardDraft(value);
  if (value && typeof value === "object") {
    try {
      return parseWizardDraft(JSON.stringify(value));
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { phone?: unknown; draft?: unknown };
    const phone = toE164UkMobile(String(payload.phone ?? ""));
    if (!phone) {
      return NextResponse.json(
        { ok: false, error: "Enter a UK mobile number so we can call you." },
        { status: 400 },
      );
    }

    const draft = readDraft(payload.draft);
    if (!draft) {
      return NextResponse.json(
        { ok: false, error: "Your setup expired. Go back and build the receptionist again." },
        { status: 400 },
      );
    }

    const service = getServiceSupabase();
    if (!service) {
      return NextResponse.json(
        { ok: false, error: "Test calls are temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    const ipKey = createCallbackRateLimitKey("ip", getCallbackClientIp(request.headers));
    const numberKey = createCallbackRateLimitKey("number", normaliseCallbackNumber(phone));
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
      console.error("Setup test callback rate limit failed", {
        ip: ipLimitResponse.error?.message,
        number: numberLimitResponse.error?.message,
      });
      return NextResponse.json(
        { ok: false, error: "Test calls are temporarily unavailable. Please try again shortly." },
        { status: 503 },
      );
    }

    const ipLimit = readCallbackRateLimitResult(ipLimitResponse.data);
    const numberLimit = readCallbackRateLimitResult(numberLimitResponse.data);
    if (!ipLimit || !numberLimit) {
      console.error("Setup test callback rate limit returned an invalid response");
      return NextResponse.json(
        { ok: false, error: "Test calls are temporarily unavailable. Please try again shortly." },
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
          error: "Too many test calls have been requested. Please wait before trying again.",
        },
        {
          status: 429,
          headers: { "Retry-After": String(retryAfterSeconds) },
        },
      );
    }

    const voiceName = guestTestVoiceName(draft.voice);
    const { ttsProvider, voiceId } = resolveVoiceRuntime(voiceName);
    const slug = guestTestAgentSlug(draft.businessName, crypto.randomUUID().replace(/-/g, "").slice(0, 8));
    const row = buildGuestTestAgentInsert(draft, {
      slug,
      voice: { ttsProvider, voiceId, voiceName },
    });

    const { error: insertError } = await service.from("wisecall_profiles").insert(row);
    if (insertError) {
      console.error("guest test agent insert failed", insertError.message);
      return NextResponse.json(
        { ok: false, error: "Could not start the test call. Try again." },
        { status: 502 },
      );
    }

    const agentName =
      draft.receptionistName.trim() || `${draft.businessName.trim()} assistant`;
    const response = await fetch(getDemoCallbackEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        guestTestCallbackBody({
          phone,
          slug,
          agentName,
        }),
      ),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "Could not start the test call.",
        },
        { status: response.status || 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message || "We are calling you now.",
      agentName,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Could not start the test call.",
      },
      { status: 500 },
    );
  }
}
