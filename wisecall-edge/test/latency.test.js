const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  computeStageLatencies,
  msBetween,
  verdictFromP95,
  percentile,
} = require("../src/latencyInstrumentation");

describe("latencyInstrumentation", () => {
  it("computes stage latencies from timestamps", () => {
    const t0 = "2026-07-04T12:00:00.000Z";
    const t1 = "2026-07-04T12:00:00.200Z";
    const t2 = "2026-07-04T12:00:00.500Z";
    const t3 = "2026-07-04T12:00:00.700Z";
    const t4 = "2026-07-04T12:00:00.900Z";

    const stages = computeStageLatencies({
      audio_received_at: t0,
      deepgram_final_at: t1,
      openai_first_token_at: t2,
      cartesia_first_audio_at: t3,
      audio_sent_to_sip_at: t4,
    });

    assert.equal(stages.stt_ms, 200);
    assert.equal(stages.llm_ms, 300);
    assert.equal(stages.tts_ms, 200);
    assert.equal(stages.sip_ms, 200);
    assert.equal(stages.total_turn_latency_ms, msBetween(t0, t4));
    assert.equal(stages.total_turn_latency_ms, 900);
  });

  it("assigns PASS/WARN/FAIL verdicts from p95", () => {
    assert.equal(verdictFromP95(800), "PASS");
    assert.equal(verdictFromP95(900), "WARN");
    assert.equal(verdictFromP95(1200), "WARN");
    assert.equal(verdictFromP95(1501), "FAIL");
  });

  it("calculates percentiles", () => {
    const sorted = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];
    assert.equal(percentile(sorted, 50), 500);
    assert.equal(percentile(sorted, 95), 1000);
  });
});
