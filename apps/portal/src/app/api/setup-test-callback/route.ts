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
  placeGuestCallbackViaTelnyx,
  readTelnyxCallbackConfig,
} from "@/lib/guest-callback-texml";
import {
  buildGuestTestAgentInsert,
  guestCallbackTargetError,
  guestRoutingNumber,
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
        { ok: false, error: "Paste your website first so we can draft your receptionist." },
        { status: 400 },
      );
    }
    if (!draft.prompt.trim() || !draft.businessName.trim()) {
      return NextResponse.json(
        { ok: false, error: "We could not draft your receptionist from that website. Try another URL." },
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

    const voiceName = guestTestVoiceName();
    const { ttsProvider, voiceId } = resolveVoiceRuntime(voiceName);
    const unique = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
    const slug = guestTestAgentSlug(draft.businessName, unique);
    const routingNumber = guestRoutingNumber(unique);
    const targetError = guestCallbackTargetError({ slug, calledNumber: routingNumber });
    if (targetError) {
      return NextResponse.json({ ok: false, error: targetError }, { status: 500 });
    }

    const row = buildGuestTestAgentInsert(draft, {
      slug,
      routingNumber,
      voice: { ttsProvider, voiceId, voiceName },
    });

    const { data: inserted, error: insertError } = await service
      .from("wisecall_profiles")
      .insert(row)
      .select("id, slug, telnyx_number, system_prompt")
      .single();

    if (insertError || !inserted) {
      console.error("guest test agent insert failed", insertError?.message);
      return NextResponse.json(
        { ok: false, error: "Could not create your receptionist. Try again." },
        { status: 502 },
      );
    }

    const liveSlug = String(inserted.slug || "");
    const liveNumber = String(inserted.telnyx_number || "");
    const liveError = guestCallbackTargetError({ slug: liveSlug, calledNumber: liveNumber });
    if (liveError || !String(inserted.system_prompt || "").trim()) {
      console.error("guest test agent insert produced an uncallable profile", {
        slug: liveSlug,
        telnyx_number: liveNumber,
        has_prompt: Boolean(String(inserted.system_prompt || "").trim()),
      });
      await service.from("wisecall_profiles").delete().eq("id", inserted.id);
      return NextResponse.json({ ok: false, error: liveError || "Could not create your receptionist. Try again." }, { status: 502 });
    }

    const agentName =
      draft.receptionistName.trim() || `${draft.businessName.trim()} assistant`;
    const callbackBody = guestTestCallbackBody({
      phone,
      slug: liveSlug,
      calledNumber: liveNumber,
      agentName,
    });

    const telnyx = readTelnyxCallbackConfig();
    if (telnyx) {
      const placed = await placeGuestCallbackViaTelnyx({
        phone,
        profileSlug: liveSlug,
        calledNumber: liveNumber,
        agentName,
        config: telnyx,
      });
      if (!placed.ok) {
        return NextResponse.json({ ok: false, error: placed.error }, { status: placed.status });
      }
      return NextResponse.json({
        ok: true,
        message: placed.message,
        agentName,
      });
    }

    const response = await fetch(getDemoCallbackEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callbackBody),
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
