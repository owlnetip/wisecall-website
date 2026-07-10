import { getServiceSupabase } from "@/lib/supabase";

export type LatencyVerdict = "PASS" | "WARN" | "FAIL";

export type LatencyTestRun = {
  id: string;
  scenario: string;
  target_number: string;
  caller_number: string | null;
  status: string;
  calls_planned: number;
  calls_completed: number;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  avg_stt_ms: number | null;
  avg_llm_ms: number | null;
  avg_tts_ms: number | null;
  avg_sip_ms: number | null;
  verdict: LatencyVerdict | null;
  created_at: string;
  completed_at: string | null;
};

export type LatencyTestCall = {
  id: string;
  test_run_id: string;
  call_id: string | null;
  mor_call_ref: string | null;
  sip_call_id: string | null;
  recording_url: string | null;
  status: string;
  p50_turn_latency_ms: number | null;
  p95_turn_latency_ms: number | null;
  max_silence_gap_ms: number | null;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
};

export type LatencyTurn = {
  id: string;
  test_run_id: string;
  call_id: string;
  turn_id: number;
  prompt_text: string | null;
  caller_audio_started_at: string | null;
  caller_audio_ended_at: string | null;
  ai_audio_first_started_at: string | null;
  client_response_latency_ms: number | null;
  silence_gaps_over_700ms: number;
  audio_received_at: string | null;
  deepgram_first_partial_at: string | null;
  deepgram_final_at: string | null;
  openai_request_started_at: string | null;
  openai_first_token_at: string | null;
  cartesia_request_started_at: string | null;
  cartesia_first_audio_at: string | null;
  audio_sent_to_sip_at: string | null;
  total_turn_latency_ms: number | null;
  stt_ms: number | null;
  llm_ms: number | null;
  tts_ms: number | null;
  sip_ms: number | null;
  created_at: string;
};

export type LatencyDashboard = {
  runs: LatencyTestRun[];
  recentCalls: (LatencyTestCall & { scenario: string })[];
  slowestTurns: LatencyTurn[];
  summary: {
    avgLatencyMs: number | null;
    p50Ms: number | null;
    p95Ms: number | null;
    p99Ms: number | null;
    avgSttMs: number | null;
    avgLlmMs: number | null;
    avgTtsMs: number | null;
    avgSipMs: number | null;
    totalTurns: number;
  };
};

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

export async function getLatencyDashboard(): Promise<LatencyDashboard> {
  const sb = getServiceSupabase();
  if (!sb) {
    return {
      runs: [],
      recentCalls: [],
      slowestTurns: [],
      summary: {
        avgLatencyMs: null,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        avgSttMs: null,
        avgLlmMs: null,
        avgTtsMs: null,
        avgSipMs: null,
        totalTurns: 0,
      },
    };
  }

  const [runsRes, callsRes, turnsRes] = await Promise.all([
    sb
      .from("voice_latency_test_runs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
    sb
      .from("voice_latency_tests")
      .select("*, voice_latency_test_runs(scenario)")
      .order("created_at", { ascending: false })
      .limit(30),
    sb
      .from("voice_latency_test_turns")
      .select("*")
      .not("total_turn_latency_ms", "is", null)
      .order("total_turn_latency_ms", { ascending: false })
      .limit(25),
  ]);

  const runs = (runsRes.data || []) as LatencyTestRun[];
  const recentCalls = ((callsRes.data || []) as Array<
    LatencyTestCall & { voice_latency_test_runs: { scenario: string } | null }
  >).map((row) => ({
    ...row,
    scenario: row.voice_latency_test_runs?.scenario || "unknown",
  }));

  const slowestTurns = (turnsRes.data || []) as LatencyTurn[];

  const { data: allTurns } = await sb
    .from("voice_latency_test_turns")
    .select(
      "total_turn_latency_ms, client_response_latency_ms, stt_ms, llm_ms, tts_ms, sip_ms",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  const latencies = (allTurns || [])
    .map((t) => t.total_turn_latency_ms ?? t.client_response_latency_ms)
    .filter((n): n is number => typeof n === "number" && n >= 0)
    .sort((a, b) => a - b);

  const stt = (allTurns || []).map((t) => t.stt_ms).filter((n): n is number => typeof n === "number");
  const llm = (allTurns || []).map((t) => t.llm_ms).filter((n): n is number => typeof n === "number");
  const tts = (allTurns || []).map((t) => t.tts_ms).filter((n): n is number => typeof n === "number");
  const sip = (allTurns || []).map((t) => t.sip_ms).filter((n): n is number => typeof n === "number");

  return {
    runs,
    recentCalls,
    slowestTurns,
    summary: {
      avgLatencyMs: average(latencies),
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
      p99Ms: percentile(latencies, 99),
      avgSttMs: average(stt),
      avgLlmMs: average(llm),
      avgTtsMs: average(tts),
      avgSipMs: average(sip),
      totalTurns: latencies.length,
    },
  };
}

export function verdictLabel(verdict: LatencyVerdict | null): string {
  if (!verdict) return "—";
  return verdict;
}

export function verdictClass(verdict: LatencyVerdict | null): string {
  if (verdict === "PASS") return "text-emerald-400";
  if (verdict === "WARN") return "text-amber-400";
  if (verdict === "FAIL") return "text-red-400";
  return "text-white/50";
}

export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  return `${ms} ms`;
}
