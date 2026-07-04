/**
 * Lightweight energy-based VAD for 16-bit mono PCM WAV buffers.
 * Used to detect when the AI agent starts speaking after caller prompts.
 */

function readPcm16Mono(wavBuffer) {
  if (wavBuffer.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("Expected WAV file");
  }
  const channels = wavBuffer.readUInt16LE(22);
  const sampleRate = wavBuffer.readUInt32LE(24);
  const bitsPerSample = wavBuffer.readUInt16LE(34);

  let offset = 12;
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString("ascii", offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === "data") {
      const dataStart = offset + 8;
      const samples = new Int16Array(
        wavBuffer.buffer,
        wavBuffer.byteOffset + dataStart,
        Math.floor(chunkSize / 2),
      );
      return { samples, sampleRate, channels, bitsPerSample };
    }
    offset += 8 + chunkSize;
  }
  throw new Error("WAV data chunk not found");
}

function frameEnergy(samples, start, frameSize) {
  let sum = 0;
  const end = Math.min(samples.length, start + frameSize);
  for (let i = start; i < end; i += 1) {
    const v = samples[i] / 32768;
    sum += v * v;
  }
  return sum / Math.max(1, end - start);
}

/**
 * Analyse a call recording to estimate per-prompt response latencies.
 * Returns turn-level client metrics based on silence → speech transitions.
 */
export function analyseRecordingLatency(wavBuffer, { promptCount = 4, minSilenceMs = 700 } = {}) {
  const { samples, sampleRate } = readPcm16Mono(wavBuffer);
  const frameMs = 20;
  const frameSize = Math.max(1, Math.floor((sampleRate * frameMs) / 1000));
  const minSilenceFrames = Math.ceil(minSilenceMs / frameMs);

  const energies = [];
  for (let i = 0; i < samples.length; i += frameSize) {
    energies.push(frameEnergy(samples, i, frameSize));
  }

  const sorted = [...energies].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] || 0.0001;
  const threshold = Math.max(noiseFloor * 4, 0.002);

  const isSpeech = energies.map((e) => e > threshold);

  const turns = [];
  let i = 0;
  let turnId = 1;
  let silenceGapsOver700 = 0;
  let silenceRun = 0;

  while (i < isSpeech.length && turnId <= promptCount) {
    while (i < isSpeech.length && !isSpeech[i]) {
      silenceRun += 1;
      i += 1;
    }
    if (i >= isSpeech.length) break;

    const callerStartFrame = i;
    while (i < isSpeech.length && isSpeech[i]) i += 1;
    const callerEndFrame = i;

    while (i < isSpeech.length && !isSpeech[i]) {
      silenceRun += 1;
      if (silenceRun >= minSilenceFrames) silenceGapsOver700 += 1;
      i += 1;
    }
    if (i >= isSpeech.length) break;

    const aiStartFrame = i;
    while (i < isSpeech.length && isSpeech[i]) i += 1;

    const callerStartMs = callerStartFrame * frameMs;
    const callerEndMs = callerEndFrame * frameMs;
    const aiStartMs = aiStartFrame * frameMs;
    const clientLatency = aiStartMs - callerEndMs;

    turns.push({
      turn_id: turnId,
      caller_audio_started_at_ms: callerStartMs,
      caller_audio_ended_at_ms: callerEndMs,
      ai_audio_first_started_at_ms: aiStartMs,
      client_response_latency_ms: Math.max(0, clientLatency),
      silence_gaps_over_700ms: silenceGapsOver700,
    });

    silenceRun = 0;
    silenceGapsOver700 = 0;
    turnId += 1;
  }

  const latencies = turns.map((t) => t.client_response_latency_ms);
  return { turns, latencies };
}

export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const arr = [...sorted].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * arr.length) - 1;
  return arr[Math.max(0, Math.min(arr.length - 1, idx))];
}

export function verdictFromP95(p95) {
  if (p95 == null) return null;
  if (p95 < 900) return "PASS";
  if (p95 <= 1500) return "WARN";
  return "FAIL";
}
