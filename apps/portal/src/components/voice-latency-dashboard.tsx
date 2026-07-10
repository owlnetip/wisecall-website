import {
  formatMs,
  verdictClass,
  verdictLabel,
  type LatencyDashboard,
} from "@/lib/latency";

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-[#7de8eb]/15 bg-[#1a3535] p-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-[#7de8eb]/70">{label}</p>
      <p className="mt-2 text-2xl font-bold text-white">{value}</p>
    </div>
  );
}

export function VoiceLatencyDashboard({ data }: { data: LatencyDashboard }) {
  const { summary, runs, recentCalls, slowestTurns } = data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">Voice latency tests</h1>
        <p className="mt-2 max-w-3xl text-white/60">
          Real outbound SIP calls via MOR measure end-to-end response time across Deepgram,
          OpenAI, and Cartesia. Run tests with{" "}
          <code className="rounded bg-white/10 px-1.5 py-0.5 text-sm text-[#7de8eb]">
            npm run test:voice-agent -- --number=&quot;+44...&quot; --scenario dental
          </code>
        </p>
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Average latency" value={formatMs(summary.avgLatencyMs)} />
        <StatCard label="p50" value={formatMs(summary.p50Ms)} />
        <StatCard label="p95" value={formatMs(summary.p95Ms)} />
        <StatCard label="p99" value={formatMs(summary.p99Ms)} />
      </div>

      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Avg STT" value={formatMs(summary.avgSttMs)} />
        <StatCard label="Avg LLM" value={formatMs(summary.avgLlmMs)} />
        <StatCard label="Avg TTS" value={formatMs(summary.avgTtsMs)} />
        <StatCard label="Avg SIP" value={formatMs(summary.avgSipMs)} />
      </div>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-white">Test runs</h2>
        <div className="overflow-x-auto rounded-2xl border border-[#7de8eb]/15">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#1a3535] text-[#7de8eb]/80">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Scenario</th>
                <th className="px-4 py-3 font-semibold">Target</th>
                <th className="px-4 py-3 font-semibold">Calls</th>
                <th className="px-4 py-3 font-semibold">p50</th>
                <th className="px-4 py-3 font-semibold">p95</th>
                <th className="px-4 py-3 font-semibold">Verdict</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-[#122929] text-white/80">
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-white/50">
                    No test runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((run) => (
                  <tr key={run.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(run.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-3">{run.scenario}</td>
                    <td className="px-4 py-3 font-mono text-xs">{run.target_number}</td>
                    <td className="px-4 py-3">
                      {run.calls_completed}/{run.calls_planned}
                    </td>
                    <td className="px-4 py-3">{formatMs(run.p50_ms)}</td>
                    <td className="px-4 py-3">{formatMs(run.p95_ms)}</td>
                    <td className={`px-4 py-3 font-bold ${verdictClass(run.verdict)}`}>
                      {verdictLabel(run.verdict)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-white">Slowest turns</h2>
        <div className="overflow-x-auto rounded-2xl border border-[#7de8eb]/15">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#1a3535] text-[#7de8eb]/80">
              <tr>
                <th className="px-4 py-3 font-semibold">Call</th>
                <th className="px-4 py-3 font-semibold">Turn</th>
                <th className="px-4 py-3 font-semibold">Total</th>
                <th className="px-4 py-3 font-semibold">STT</th>
                <th className="px-4 py-3 font-semibold">LLM</th>
                <th className="px-4 py-3 font-semibold">TTS</th>
                <th className="px-4 py-3 font-semibold">SIP</th>
                <th className="px-4 py-3 font-semibold">Client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-[#122929] text-white/80">
              {slowestTurns.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-white/50">
                    No turn metrics yet.
                  </td>
                </tr>
              ) : (
                slowestTurns.map((turn) => (
                  <tr key={turn.id}>
                    <td className="px-4 py-3 font-mono text-xs">{turn.call_id?.slice(0, 16)}…</td>
                    <td className="px-4 py-3">{turn.turn_id}</td>
                    <td className="px-4 py-3 font-semibold text-white">
                      {formatMs(turn.total_turn_latency_ms)}
                    </td>
                    <td className="px-4 py-3">{formatMs(turn.stt_ms)}</td>
                    <td className="px-4 py-3">{formatMs(turn.llm_ms)}</td>
                    <td className="px-4 py-3">{formatMs(turn.tts_ms)}</td>
                    <td className="px-4 py-3">{formatMs(turn.sip_ms)}</td>
                    <td className="px-4 py-3">{formatMs(turn.client_response_latency_ms)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold text-white">Recent calls & recordings</h2>
        <div className="overflow-x-auto rounded-2xl border border-[#7de8eb]/15">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-[#1a3535] text-[#7de8eb]/80">
              <tr>
                <th className="px-4 py-3 font-semibold">When</th>
                <th className="px-4 py-3 font-semibold">Scenario</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">p95</th>
                <th className="px-4 py-3 font-semibold">Recording</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 bg-[#122929] text-white/80">
              {recentCalls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-white/50">
                    No calls recorded yet.
                  </td>
                </tr>
              ) : (
                recentCalls.map((call) => (
                  <tr key={call.id}>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(call.created_at).toLocaleString("en-GB")}
                    </td>
                    <td className="px-4 py-3">{call.scenario}</td>
                    <td className="px-4 py-3">{call.status}</td>
                    <td className="px-4 py-3">{formatMs(call.p95_turn_latency_ms)}</td>
                    <td className="px-4 py-3">
                      {call.recording_url ? (
                        <a
                          href={call.recording_url}
                          className="text-[#7de8eb] hover:underline"
                          target="_blank"
                          rel="noreferrer"
                        >
                          Listen
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
