#!/usr/bin/env node
// WiseCall voice-agent latency test harness.
//
// Places real outbound calls via Twilio to a live WiseCall number, plays scripted
// prompts, records the call, analyses response latency, and correlates with
// server-side middleware metrics in Supabase.
//
// Usage (from apps/portal):
//   npm run test:voice-agent -- --number "+441135222277" --scenario dental
//   npm run test:voice-agent -- --number "+44..." --scenario dental --calls 10
//
// Required env:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//   TWILIO_ACCOUNT_SID
//   TWILIO_AUTH_TOKEN
//   TWILIO_LATENCY_TEST_FROM  (verified outbound caller ID)
//
// Optional:
//   WISECALL_LATENCY_POLL_SEC=90  (wait for server-side turn metrics)

import { createClient } from "@supabase/supabase-js";
import { buildTwilioTwiml, getScenario } from "./latency-scenarios.mjs";
import { analyseRecordingLatency, percentile, verdictFromP95 } from "./latency-audio-analyzer.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);

const targetNumber = typeof args.number === "string" ? args.number : null;
const scenarioId = typeof args.scenario === "string" ? args.scenario : "dental";
const callsPlanned = Math.min(20, Math.max(1, Number(args.calls) || 5));
const pollSec = Number(process.env.WISECALL_LATENCY_POLL_SEC) || 90;

if (!targetNumber) {
  console.error("Usage: npm run test:voice-agent -- --number=\"+44...\" [--scenario=dental] [--calls=5]");
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const twilioSid = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const twilioFrom = process.env.TWILIO_LATENCY_TEST_FROM || process.env.TWILIO_FROM_NUMBER;

for (const [name, val] of [
  ["SUPABASE_URL", url],
  ["SUPABASE_SERVICE_ROLE_KEY", serviceKey],
  ["TWILIO_ACCOUNT_SID", twilioSid],
  ["TWILIO_AUTH_TOKEN", twilioToken],
  ["TWILIO_LATENCY_TEST_FROM", twilioFrom],
]) {
  if (!val) {
    console.error(`Missing ${name}. This harness requires real Twilio + Supabase credentials.`);
    process.exit(1);
  }
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const scenario = getScenario(scenarioId);
const twiml = buildTwilioTwiml(scenario);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function twilioRequest(path, body) {
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Twilio ${res.status}: ${text}`);
  return Object.fromEntries(new URLSearchParams(text));
}

async function fetchRecordingWav(recordingSid) {
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Recordings/${recordingSid}.wav`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  if (!res.ok) throw new Error(`Recording download failed: ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function waitForCallComplete(callSid, maxSec = 300) {
  const deadline = Date.now() + maxSec * 1000;
  while (Date.now() < deadline) {
    const call = await twilioRequest(`/Calls/${callSid}.json`, {});
    if (call.Status === "completed" || call.Status === "busy" || call.Status === "failed" || call.Status === "no-answer") {
      return call;
    }
    await sleep(3000);
  }
  throw new Error(`Call ${callSid} did not complete within ${maxSec}s`);
}

async function listRecordings(callSid) {
  const auth = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Calls/${callSid}/Recordings.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const json = await res.json();
  return json.recordings || [];
}

async function pollServerTurns(callId, testRunId, testId) {
  const deadline = Date.now() + pollSec * 1000;
  while (Date.now() < deadline) {
    const query = supabase
      .from("voice_latency_test_turns")
      .select("*")
      .eq("test_run_id", testRunId);
    if (callId) query.eq("call_id", callId);

    const { data } = await query;
    const serverTurns = (data || []).filter((t) => t.total_turn_latency_ms != null);
    if (serverTurns.length >= scenario.prompts.length) return serverTurns;

    // Also try matching recent call_logs by caller + time
    await sleep(5000);
  }
  return [];
}

async function correlateCallLog(callerNumber, target, startedAt) {
  const since = new Date(new Date(startedAt).getTime() - 60_000).toISOString();
  const { data } = await supabase
    .from("wisecall_call_logs")
    .select("id, call_id, caller_id, started_at")
    .eq("caller_id", callerNumber)
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(5);

  return (data || []).find((row) => {
    const meta = row;
    return row.caller_id === callerNumber;
  });
}

function msToIso(baseMs, offsetMs) {
  return new Date(baseMs + offsetMs).toISOString();
}

async function runSingleCall(testRunId, callIndex) {
  console.log(`\n── Call ${callIndex + 1}/${callsPlanned} → ${targetNumber}`);

  const { data: testRow, error: testErr } = await supabase
    .from("voice_latency_tests")
    .insert({
      test_run_id: testRunId,
      status: "in_progress",
      started_at: new Date().toISOString(),
      metadata: { scenario: scenarioId, call_index: callIndex },
    })
    .select("id")
    .single();
  if (testErr) throw new Error(testErr.message);
  const testId = testRow.id;

  const startedAt = Date.now();
  const call = await twilioRequest("/Calls.json", {
    To: targetNumber,
    From: twilioFrom,
    Twiml: twiml,
    Record: "true",
    Timeout: "120",
    MachineDetection: "Enable",
    AsyncAmd: "true",
    AsyncAmdStatusCallbackMethod: "POST",
  });

  const callSid = call.Sid;
  console.log(`  Twilio call SID: ${callSid}`);

  await supabase
    .from("voice_latency_tests")
    .update({ twilio_call_sid: callSid })
    .eq("id", testId);

  const completed = await waitForCallComplete(callSid);
  console.log(`  Status: ${completed.Status}, duration: ${completed.Duration}s`);

  const recordings = await listRecordings(callSid);
  const recording = recordings[0];
  let clientTurns = [];
  let recordingUrl = null;

  if (recording?.sid) {
    recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Recordings/${recording.sid}.wav`;
    try {
      const wav = await fetchRecordingWav(recording.sid);
      const analysis = analyseRecordingLatency(wav, { promptCount: scenario.prompts.length });
      clientTurns = analysis.turns;
      console.log(`  Recording analysed: ${clientTurns.length} turn(s) detected`);
    } catch (err) {
      console.warn(`  Recording analysis failed: ${err.message}`);
    }
  } else {
    console.warn("  No recording available for client-side analysis");
  }

  const callLog = await correlateCallLog(twilioFrom, targetNumber, startedAt);
  const wiseCallId = callLog?.call_id || callSid;

  for (const turn of clientTurns) {
    const prompt = scenario.prompts[turn.turn_id - 1] || null;
    await supabase.from("voice_latency_test_turns").upsert(
      {
        test_run_id: testRunId,
        test_id: testId,
        call_id: wiseCallId,
        turn_id: turn.turn_id,
        prompt_text: prompt,
        caller_audio_started_at: msToIso(startedAt, turn.caller_audio_started_at_ms),
        caller_audio_ended_at: msToIso(startedAt, turn.caller_audio_ended_at_ms),
        ai_audio_first_started_at: msToIso(startedAt, turn.ai_audio_first_started_at_ms),
        client_response_latency_ms: turn.client_response_latency_ms,
        silence_gaps_over_700ms: turn.silence_gaps_over_700ms,
      },
      { onConflict: "call_id,turn_id" },
    );
  }

  const serverTurns = await pollServerTurns(wiseCallId, testRunId, testId);
  if (serverTurns.length) {
    console.log(`  Server metrics: ${serverTurns.length} turn(s) from middleware`);
  } else {
    console.warn(
      "  No server-side turn metrics yet — ensure SIP bridge posts to /api/webhooks/latency-turn",
    );
  }

  const allLatencies = [
    ...clientTurns.map((t) => t.client_response_latency_ms),
    ...serverTurns.map((t) => t.total_turn_latency_ms).filter(Boolean),
  ];
  const p50 = percentile(allLatencies, 50);
  const p95 = percentile(allLatencies, 95);
  const maxSilence = Math.max(0, ...clientTurns.map((t) => t.silence_gaps_over_700ms || 0));

  await supabase
    .from("voice_latency_tests")
    .update({
      call_id: wiseCallId,
      call_log_id: callLog?.id || null,
      recording_url: recordingUrl,
      status: serverTurns.length ? "completed" : "no_server_metrics",
      p50_turn_latency_ms: p50,
      p95_turn_latency_ms: p95,
      max_silence_gap_ms: maxSilence * 700,
      ended_at: new Date().toISOString(),
    })
    .eq("id", testId);

  return { p50, p95, latencies: allLatencies, callSid, wiseCallId };
}

async function finalizeRun(testRunId, allLatencies) {
  const sorted = [...allLatencies].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const verdict = verdictFromP95(p95);

  const { data: turns } = await supabase
    .from("voice_latency_test_turns")
    .select("stt_ms, llm_ms, tts_ms, sip_ms")
    .eq("test_run_id", testRunId);

  const avg = (key) => {
    const vals = (turns || []).map((t) => t[key]).filter((n) => typeof n === "number");
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };

  await supabase
    .from("voice_latency_test_runs")
    .update({
      status: "completed",
      completed_at: new Date().toISOString(),
      calls_completed: callsPlanned,
      p50_ms: p50,
      p95_ms: p95,
      p99_ms: p99,
      avg_stt_ms: avg("stt_ms"),
      avg_llm_ms: avg("llm_ms"),
      avg_tts_ms: avg("tts_ms"),
      avg_sip_ms: avg("sip_ms"),
      verdict,
    })
    .eq("id", testRunId);

  return { p50, p95, p99, verdict };
}

function printSummary(run) {
  console.log("\n══════════════════════════════════════════");
  console.log("  WiseCall Voice Latency Test Summary");
  console.log("══════════════════════════════════════════");
  console.log(`  Scenario:     ${scenario.label}`);
  console.log(`  Target:       ${targetNumber}`);
  console.log(`  Calls:        ${callsPlanned}`);
  console.log(`  p50 latency:  ${run.p50 ?? "—"} ms`);
  console.log(`  p95 latency:  ${run.p95 ?? "—"} ms`);
  console.log(`  p99 latency:  ${run.p99 ?? "—"} ms`);
  console.log(`  Verdict:      ${run.verdict ?? "INCOMPLETE"}`);
  console.log("──────────────────────────────────────────");
  if (run.verdict === "PASS") console.log("  ✓ PASS — p95 under 900ms");
  else if (run.verdict === "WARN") console.log("  ⚠ WARN — p95 between 900–1500ms");
  else if (run.verdict === "FAIL") console.log("  ✗ FAIL — p95 over 1500ms");
  else console.log("  ? Incomplete — not enough latency data");
  console.log("══════════════════════════════════════════\n");
}

async function main() {
  console.log(`WiseCall latency test — ${scenario.label}`);
  console.log(`Placing ${callsPlanned} call(s) to ${targetNumber}`);

  const { data: runRow, error: runErr } = await supabase
    .from("voice_latency_test_runs")
    .insert({
      scenario: scenarioId,
      target_number: targetNumber,
      caller_number: twilioFrom,
      calls_planned: callsPlanned,
      status: "running",
      metadata: { harness: "twilio", prompts: scenario.prompts },
    })
    .select("id")
    .single();
  if (runErr) throw new Error(runErr.message);
  const testRunId = runRow.id;

  const allLatencies = [];
  try {
    for (let i = 0; i < callsPlanned; i += 1) {
      const result = await runSingleCall(testRunId, i);
      allLatencies.push(...result.latencies);
      if (i < callsPlanned - 1) await sleep(5000);
    }
    const summary = await finalizeRun(testRunId, allLatencies);
    printSummary(summary);
    process.exit(summary.verdict === "FAIL" ? 1 : 0);
  } catch (err) {
    await supabase
      .from("voice_latency_test_runs")
      .update({ status: "failed", completed_at: new Date().toISOString() })
      .eq("id", testRunId);
    console.error("Test run failed:", err.message);
    process.exit(1);
  }
}

main();
