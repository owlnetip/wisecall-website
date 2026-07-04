#!/usr/bin/env node
// WiseCall voice-agent latency test harness.
//
// Places real outbound SIP calls through MOR to a live WiseCall DID, plays
// scripted prompts via SIPp, and correlates with server-side middleware metrics.
//
// Usage (from apps/portal):
//   npm run test:voice-agent -- --number "+441135222277" --scenario dental
//   npm run test:voice-agent -- --number "+44..." --scenario dental --calls 10
//
// Required env:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
//   SUPABASE_SERVICE_ROLE_KEY
//   MOR_LATENCY_TEST_SIP_USER       — SIP device username on MOR (test caller)
//   MOR_LATENCY_TEST_SIP_PASSWORD   — SIP device password
//   MOR_SIP_DOMAIN or MOR_API_URL   — MOR SIP registrar host
//
// Optional:
//   MOR_SIP_PORT=5060
//   MOR_API_URL / MOR_UNIQUE_HASH / MOR_WISECALL_RESELLER_USERNAME — for CDR correlation
//   WISECALL_LATENCY_POLL_SEC=90
//   SIPP_BIN=/usr/bin/sipp
//
// First-time setup per scenario:
//   node scripts/generate-latency-prompts.mjs --scenario=dental

import { createClient } from "@supabase/supabase-js";
import { percentile, verdictFromP95 } from "./latency-audio-analyzer.mjs";
import { findRecentMorCall, loadMorConfig } from "./mor-client.mjs";
import { getScenario } from "./latency-scenarios.mjs";
import { placeMorSipCall } from "./sip-caller.mjs";

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
  console.error(
    'Usage: npm run test:voice-agent -- --number="+44..." [--scenario=dental] [--calls=5]',
  );
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const scenario = getScenario(scenarioId);
const morConfig = loadMorConfig();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pollServerTurns(callId, testRunId) {
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
    await sleep(5000);
  }
  return [];
}

async function correlateCallLog(callerRef, startedAt) {
  const since = new Date(new Date(startedAt).getTime() - 120_000).toISOString();
  const { data } = await supabase
    .from("wisecall_call_logs")
    .select("id, call_id, caller_id, started_at, recording_url")
    .gte("started_at", since)
    .order("started_at", { ascending: false })
    .limit(10);

  const callerDigits = String(callerRef).replace(/[^\d]/g, "").slice(-10);
  return (data || []).find((row) => {
    const from = String(row.caller_id || "").replace(/[^\d]/g, "");
    return from.endsWith(callerDigits) || from.includes(callerDigits);
  });
}

async function runSingleCall(testRunId, callIndex) {
  console.log(`\n── Call ${callIndex + 1}/${callsPlanned} → ${targetNumber} (MOR/SIP)`);

  const startedAt = new Date().toISOString();
  const { data: testRow, error: testErr } = await supabase
    .from("voice_latency_tests")
    .insert({
      test_run_id: testRunId,
      status: "in_progress",
      started_at: startedAt,
      metadata: { scenario: scenarioId, call_index: callIndex, transport: "mor_sip" },
    })
    .select("id")
    .single();
  if (testErr) throw new Error(testErr.message);
  const testId = testRow.id;

  const sipResult = await placeMorSipCall({
    targetNumber,
    scenarioId,
    testRunId,
    callIndex,
  });

  if (!sipResult.ok) {
    console.warn(`  SIPp exited with code ${sipResult.exitCode} (call may still have connected)`);
  }

  // Correlate via MOR CDR, SIP Call-ID, or recent call log
  let morCall = null;
  try {
    morCall = await findRecentMorCall(morConfig, {
      src: sipResult.callerNumber,
      dst: targetNumber,
      sinceIso: startedAt,
    });
  } catch (err) {
    console.warn(`  MOR CDR lookup skipped: ${err.message}`);
  }

  const callLog = await correlateCallLog(sipResult.callerNumber, startedAt);
  const wiseCallId = callLog?.call_id || morCall?.uniqueid || sipResult.morCallRef || `sip-${testId}`;

  await supabase
    .from("voice_latency_tests")
    .update({
      mor_call_ref: morCall?.uniqueid || sipResult.morCallRef,
      sip_call_id: sipResult.morCallRef,
      call_id: wiseCallId,
    })
    .eq("id", testId);

  // Client-side turn analysis is optional (requires local RTP capture; server metrics are primary)
  let clientTurns = [];
  const recordingUrl = callLog?.recording_url || null;

  const serverTurns = await pollServerTurns(wiseCallId, testRunId);
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
      call_log_id: callLog?.id || null,
      recording_url: recordingUrl,
      status: serverTurns.length ? "completed" : "no_server_metrics",
      p50_turn_latency_ms: p50,
      p95_turn_latency_ms: p95,
      max_silence_gap_ms: maxSilence * 700,
      ended_at: new Date().toISOString(),
      metadata: {
        scenario: scenarioId,
        call_index: callIndex,
        transport: "mor_sip",
        mor_uniqueid: morCall?.uniqueid || null,
        sipp_logs: sipResult.logs,
      },
    })
    .eq("id", testId);

  return { p50, p95, latencies: allLatencies, wiseCallId };
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
  console.log("  Transport: MOR SIP (SIPp)");
  console.log("══════════════════════════════════════════");
  console.log(`  Scenario:     ${scenario.label}`);
  console.log(`  Target DID:   ${targetNumber}`);
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
  console.log(`Placing ${callsPlanned} SIP call(s) via MOR to ${targetNumber}`);
  console.log(
    `Caller SIP user: ${morConfig.sipUser || "(set MOR_LATENCY_TEST_SIP_USER)"} @ ${morConfig.sipHost || "MOR"}`,
  );

  const { data: runRow, error: runErr } = await supabase
    .from("voice_latency_test_runs")
    .insert({
      scenario: scenarioId,
      target_number: targetNumber,
      caller_number: morConfig.sipUser || null,
      calls_planned: callsPlanned,
      status: "running",
      metadata: {
        harness: "mor_sip_sipp",
        prompts: scenario.prompts,
        mor_sip_host: morConfig.sipHost,
      },
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
      if (i < callsPlanned - 1) await sleep(8000);
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
