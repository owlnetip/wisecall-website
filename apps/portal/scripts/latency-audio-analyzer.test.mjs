import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { analyseRecordingLatency, percentile, verdictFromP95 } from "./latency-audio-analyzer.mjs";

function makeWav(samples, sampleRate = 8000) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    buffer.writeInt16LE(samples[i], 44 + i * 2);
  }
  return buffer;
}

function silence(frames) {
  return new Array(frames).fill(0);
}

function tone(frames, amplitude = 12000) {
  return new Array(frames).fill(amplitude);
}

describe("latency-audio-analyzer", () => {
  it("detects caller and AI speech segments", () => {
    const sampleRate = 8000;
    const frame = Math.floor(sampleRate * 0.02);
    const samples = [
      ...silence(frame * 5),
      ...tone(frame * 15),
      ...silence(frame * 40),
      ...tone(frame * 20),
      ...silence(frame * 30),
    ];
    const wav = makeWav(samples, sampleRate);
    const { turns } = analyseRecordingLatency(wav, { promptCount: 1 });
    assert.equal(turns.length, 1);
    assert.ok(turns[0].client_response_latency_ms >= 0);
  });

  it("scores PASS/WARN/FAIL from p95", () => {
    assert.equal(verdictFromP95(850), "PASS");
    assert.equal(verdictFromP95(1000), "WARN");
    assert.equal(verdictFromP95(2000), "FAIL");
    assert.equal(percentile([100, 200, 300], 50), 200);
  });
});
