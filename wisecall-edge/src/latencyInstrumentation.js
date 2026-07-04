// Server-side latency instrumentation for the live SIP / MOR voice pipeline.
// Called by the telephony handler at each stage of a conversational turn.

const { getSupabase } = require("./lib/supabase");

function parseTs(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function msBetween(start, end) {
  const a = parseTs(start);
  const b = parseTs(end);
  if (!a || !b) return null;
  return Math.max(0, b.getTime() - a.getTime());
}

function computeStageLatencies(row) {
  const stt =
    msBetween(row.audio_received_at, row.deepgram_final_at) ??
    msBetween(row.audio_received_at, row.deepgram_first_partial_at);
  const llm = msBetween(row.deepgram_final_at, row.openai_first_token_at);
  const tts = msBetween(row.openai_first_token_at, row.cartesia_first_audio_at);
  const sip = msBetween(row.cartesia_first_audio_at, row.audio_sent_to_sip_at);
  const total =
    row.total_turn_latency_ms ??
    msBetween(row.audio_received_at, row.audio_sent_to_sip_at);

  return {
    stt_ms: stt,
    llm_ms: llm,
    tts_ms: tts,
    sip_ms: sip,
    total_turn_latency_ms: total,
  };
}

function buildTurnRow(payload) {
  const stages = computeStageLatencies(payload);
  return {
    test_run_id: payload.test_run_id || null,
    test_id: payload.test_id || null,
    call_id: payload.call_id,
    turn_id: payload.turn_id,
    prompt_text: payload.prompt_text || null,
    audio_received_at: payload.audio_received_at || null,
    deepgram_first_partial_at: payload.deepgram_first_partial_at || null,
    deepgram_final_at: payload.deepgram_final_at || null,
    openai_request_started_at: payload.openai_request_started_at || null,
    openai_first_token_at: payload.openai_first_token_at || null,
    cartesia_request_started_at: payload.cartesia_request_started_at || null,
    cartesia_first_audio_at: payload.cartesia_first_audio_at || null,
    audio_sent_to_sip_at: payload.audio_sent_to_sip_at || null,
    caller_audio_started_at: payload.caller_audio_started_at || null,
    caller_audio_ended_at: payload.caller_audio_ended_at || null,
    ai_audio_first_started_at: payload.ai_audio_first_started_at || null,
    client_response_latency_ms: payload.client_response_latency_ms ?? null,
    silence_gaps_over_700ms: payload.silence_gaps_over_700ms ?? 0,
    ...stages,
  };
}

/**
 * Upsert per-turn latency metrics from the live middleware.
 * The SIP bridge should call this after each conversational turn completes.
 */
async function recordTurnLatency(payload) {
  if (!payload?.call_id || payload.turn_id == null) {
    throw new Error("recordTurnLatency requires call_id and turn_id");
  }

  const sb = getSupabase();
  if (!sb) {
    console.warn("[latency] Supabase not configured; skipping turn record");
    return { ok: false, skipped: true };
  }

  const row = buildTurnRow(payload);
  const { data, error } = await sb
    .from("voice_latency_test_turns")
    .upsert(row, { onConflict: "call_id,turn_id" })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[latency] recordTurnLatency:", error.message);
    throw new Error(error.message);
  }

  return { ok: true, id: data?.id };
}

async function createLatencyTestRun({
  scenario,
  targetNumber,
  callerNumber,
  profileId,
  callsPlanned = 5,
  metadata = {},
}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const { data, error } = await sb
    .from("voice_latency_test_runs")
    .insert({
      scenario,
      target_number: targetNumber,
      caller_number: callerNumber || null,
      profile_id: profileId || null,
      calls_planned: callsPlanned,
      status: "running",
      metadata,
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

async function createLatencyTestCall({ testRunId, twilioCallSid }) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const { data, error } = await sb
    .from("voice_latency_tests")
    .insert({
      test_run_id: testRunId,
      twilio_call_sid: twilioCallSid || null,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  return data.id;
}

async function finalizeLatencyTestCall(testId, updates = {}) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const { error } = await sb
    .from("voice_latency_tests")
    .update({
      ...updates,
      ended_at: updates.ended_at || new Date().toISOString(),
    })
    .eq("id", testId);

  if (error) throw new Error(error.message);
  return { ok: true };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function verdictFromP95(p95) {
  if (p95 == null) return null;
  if (p95 < 900) return "PASS";
  if (p95 <= 1500) return "WARN";
  return "FAIL";
}

async function finalizeLatencyTestRun(testRunId) {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase not configured");

  const { data: turns, error } = await sb
    .from("voice_latency_test_turns")
    .select(
      "total_turn_latency_ms, stt_ms, llm_ms, tts_ms, sip_ms, client_response_latency_ms",
    )
    .eq("test_run_id", testRunId);

  if (error) throw new Error(error.message);

  const latencies = (turns || [])
    .map((t) => t.total_turn_latency_ms ?? t.client_response_latency_ms)
    .filter((n) => typeof n === "number" && n >= 0)
    .sort((a, b) => a - b);

  const avg = (key) => {
    const vals = (turns || []).map((t) => t[key]).filter((n) => typeof n === "number");
    if (!vals.length) return null;
    return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
  };

  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);

  const { count: callsCompleted } = await sb
    .from("voice_latency_tests")
    .select("id", { count: "exact", head: true })
    .eq("test_run_id", testRunId)
    .eq("status", "completed");

  const { error: updErr } = await sb
    .from("voice_latency_test_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      calls_completed: callsCompleted ?? 0,
      p50_ms: p50,
      p95_ms: p95,
      p99_ms: p99,
      avg_stt_ms: avg("stt_ms"),
      avg_llm_ms: avg("llm_ms"),
      avg_tts_ms: avg("tts_ms"),
      avg_sip_ms: avg("sip_ms"),
      verdict: verdictFromP95(p95),
    })
    .eq("id", testRunId);

  if (updErr) throw new Error(updErr.message);

  return { p50, p95, p99, verdict: verdictFromP95(p95), turnCount: latencies.length };
}

module.exports = {
  recordTurnLatency,
  createLatencyTestRun,
  createLatencyTestCall,
  finalizeLatencyTestCall,
  finalizeLatencyTestRun,
  computeStageLatencies,
  msBetween,
  verdictFromP95,
  percentile,
};
