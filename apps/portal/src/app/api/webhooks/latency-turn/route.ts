import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

function getAcceptedWebhookSecrets(): string[] {
  return [
    process.env.WISECALL_WEBHOOK_SECRET,
    process.env.WISECALL_TRIAL_REMINDER_SECRET,
    process.env.WISECALL_POOL_REPLENISH_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function msBetween(start?: string | null, end?: string | null): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, b - a);
}

function computeStages(body: Record<string, string | number | null | undefined>) {
  const stt =
    msBetween(body.audio_received_at as string, body.deepgram_final_at as string) ??
    msBetween(body.audio_received_at as string, body.deepgram_first_partial_at as string);
  const llm = msBetween(body.deepgram_final_at as string, body.openai_first_token_at as string);
  const tts = msBetween(
    body.openai_first_token_at as string,
    body.cartesia_first_audio_at as string,
  );
  const sip = msBetween(
    body.cartesia_first_audio_at as string,
    body.audio_sent_to_sip_at as string,
  );
  const total =
    typeof body.total_turn_latency_ms === "number"
      ? body.total_turn_latency_ms
      : msBetween(body.audio_received_at as string, body.audio_sent_to_sip_at as string);

  return { stt_ms: stt, llm_ms: llm, tts_ms: tts, sip_ms: sip, total_turn_latency_ms: total };
}

// POST /api/webhooks/latency-turn
// Header: x-wisecall-secret
// Body: per-turn pipeline timestamps from the live SIP bridge middleware.
export async function POST(request: Request) {
  const secrets = getAcceptedWebhookSecrets();
  if (secrets.length === 0) {
    return NextResponse.json({ ok: false, error: "Webhook not configured." }, { status: 503 });
  }

  const provided =
    request.headers.get("x-wisecall-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!secrets.includes(provided)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const callId = typeof body.call_id === "string" ? body.call_id : null;
  const turnId = typeof body.turn_id === "number" ? body.turn_id : Number(body.turn_id);
  if (!callId || !Number.isFinite(turnId)) {
    return NextResponse.json({ ok: false, error: "Missing call_id or turn_id." }, { status: 400 });
  }

  const sb = getServiceSupabase();
  if (!sb) {
    return NextResponse.json({ ok: false, error: "Database not configured." }, { status: 503 });
  }

  const stages = computeStages(body as Record<string, string | number | null | undefined>);
  const row = {
    test_run_id: typeof body.test_run_id === "string" ? body.test_run_id : null,
    test_id: typeof body.test_id === "string" ? body.test_id : null,
    call_id: callId,
    turn_id: turnId,
    prompt_text: typeof body.prompt_text === "string" ? body.prompt_text : null,
    audio_received_at: body.audio_received_at || null,
    deepgram_first_partial_at: body.deepgram_first_partial_at || null,
    deepgram_final_at: body.deepgram_final_at || null,
    openai_request_started_at: body.openai_request_started_at || null,
    openai_first_token_at: body.openai_first_token_at || null,
    cartesia_request_started_at: body.cartesia_request_started_at || null,
    cartesia_first_audio_at: body.cartesia_first_audio_at || null,
    audio_sent_to_sip_at: body.audio_sent_to_sip_at || null,
    caller_audio_started_at: body.caller_audio_started_at || null,
    caller_audio_ended_at: body.caller_audio_ended_at || null,
    ai_audio_first_started_at: body.ai_audio_first_started_at || null,
    client_response_latency_ms:
      typeof body.client_response_latency_ms === "number"
        ? body.client_response_latency_ms
        : null,
    silence_gaps_over_700ms:
      typeof body.silence_gaps_over_700ms === "number" ? body.silence_gaps_over_700ms : 0,
    ...stages,
  };

  const { data, error } = await sb
    .from("voice_latency_test_turns")
    .upsert(row, { onConflict: "call_id,turn_id" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("/api/webhooks/latency-turn failed:", error.message);
    return NextResponse.json({ ok: false, error: "Persist failed." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data?.id, ...stages });
}
