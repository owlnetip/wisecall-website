// Shared MOR transfer-recording helpers. Keep in lockstep with
// wisecall-edge/src/lib/transferRecording.js — the telephony host imports that
// copy; this one is what the MOR call-end webhook runs.

export const POST_TRANSFER_MARKER = "--- After transfer ---";

export type MorCallEndEvent = {
  userId: string;
  deviceId: string;
  calltime: string;
  src: string;
  dst: string;
  hangupcause: string;
  billsec: number;
  uniqueid: string;
  token: string;
};

export type MorRecording = {
  id: string | null;
  userId: string | null;
  srcDeviceId: string | null;
  dstDeviceId: string | null;
  date: string | null;
  durationSec: number;
  source: string | null;
  destination: string | null;
  uniqueid: string | null;
  size: number;
  mp3Url: string | null;
};

export type CallLogMatch = {
  id: string;
  caller_id?: string | null;
  outcome?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  sip_call_id?: string | null;
  metadata?: Record<string, unknown> | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isTransferOutcome(outcome: unknown): boolean {
  return /transfer/i.test(String(outcome || ""));
}

export function phoneDigits(value: unknown): string {
  return String(value || "").replace(/\D/g, "");
}

export function phonesMatch(a: unknown, b: unknown): boolean {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const tailLen = Math.min(10, left.length, right.length);
  if (tailLen < 9) return false;
  return left.slice(-tailLen) === right.slice(-tailLen);
}

function normalizeTranscript(value: unknown): string {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function mergeLiveAndRecordingTranscript(live: unknown, recording: unknown): string {
  const liveText = String(live || "").trim();
  const recordingText = String(recording || "").trim();
  if (!recordingText) return liveText;
  if (!liveText) return recordingText;

  const liveNorm = normalizeTranscript(liveText);
  const recordingNorm = normalizeTranscript(recordingText);
  if (!recordingNorm || liveNorm === recordingNorm) return liveText;
  if (liveNorm.includes(recordingNorm) && recordingText.length <= liveText.length) {
    return liveText;
  }

  const liveHead = liveNorm.slice(0, Math.min(120, liveNorm.length));
  const looksLikeFullCall =
    liveHead.length >= 24 &&
    recordingNorm.includes(liveHead) &&
    recordingText.length >= Math.floor(liveText.length * 0.8);
  if (looksLikeFullCall) return recordingText;

  if (liveText.includes(POST_TRANSFER_MARKER) && liveText.includes(recordingText)) {
    return liveText;
  }

  return `${liveText}\n\n${POST_TRANSFER_MARKER}\n${recordingText}`;
}

export function xmlTag(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || null;
}

export function parseMorRecordingsXml(xml: string): MorRecording[] {
  const blocks = xml.match(/<recording>[\s\S]*?<\/recording>/gi) || [];
  return blocks
    .map((block) => ({
      id: xmlTag(block, "id"),
      userId: xmlTag(block, "user_id"),
      srcDeviceId: xmlTag(block, "src_device_id"),
      dstDeviceId: xmlTag(block, "dst_device_id"),
      date: xmlTag(block, "date"),
      durationSec: Number(xmlTag(block, "duration") || 0) || 0,
      source: xmlTag(block, "source"),
      destination: xmlTag(block, "destination"),
      uniqueid: xmlTag(block, "uniqueid"),
      size: Number(xmlTag(block, "size") || 0) || 0,
      mp3Url: xmlTag(block, "mp3_url"),
    }))
    .filter((row) => row.mp3Url || row.id);
}

export function pickMorRecording(
  recordings: MorRecording[],
  event: { uniqueid?: string; deviceId?: string; src?: string; dst?: string } = {},
): MorRecording | null {
  if (!recordings.length) return null;
  const scored = recordings
    .map((row) => {
      let score = 0;
      if (event.uniqueid && row.uniqueid && String(row.uniqueid) === String(event.uniqueid)) {
        score += 50;
      }
      if (event.deviceId) {
        const device = String(event.deviceId);
        if (row.srcDeviceId === device) score += 8;
        if (row.dstDeviceId === device) score += 4;
      }
      if (event.src && phonesMatch(row.source, event.src)) score += 6;
      if (event.dst && phonesMatch(row.destination, event.dst)) score += 6;
      if (row.mp3Url) score += 2;
      if (row.durationSec > 0) score += 1;
      return { row, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored[0]?.row || null;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function parseMorCallEndParams(input: string | URLSearchParams | Record<string, unknown>): MorCallEndEvent {
  let params: URLSearchParams | Record<string, unknown> | null = null;
  if (typeof input === "string") {
    const raw = input.trim();
    if (raw) {
      try {
        params = raw.includes("://")
          ? new URL(raw).searchParams
          : new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
      } catch {
        params = new URLSearchParams(raw.replace(/^\?/, ""));
      }
    }
  } else {
    params = input;
  }

  const read = (key: string): string => {
    if (!params) return "";
    if (params instanceof URLSearchParams) return firstString(params.get(key));
    if (typeof (params as URLSearchParams).get === "function") {
      return firstString((params as URLSearchParams).get(key));
    }
    if (isPlainObject(params)) return firstString(params[key]);
    return "";
  };

  return {
    userId: read("user_id"),
    deviceId: read("device_id"),
    calltime: read("calltime"),
    src: read("src"),
    dst: read("dst"),
    hangupcause: read("hangupcause"),
    billsec: Number(read("billsec") || 0) || 0,
    uniqueid: read("uniqueid"),
    token: read("token"),
  };
}

export function morCallEndWebhookUrl(supabaseUrl: string, token?: string): string {
  const base = String(supabaseUrl || "").trim().replace(/\/+$/, "");
  if (!base) return "";
  const url = new URL(`${base}/functions/v1/wisecall-mor-call-end`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

export function scoreCallLogMatch(log: CallLogMatch, event: MorCallEndEvent, nowMs = Date.now()): number {
  const metadata = isPlainObject(log.metadata) ? log.metadata : {};
  let score = 0;
  if (metadata.awaiting_post_transfer_recording === true) score += 20;
  if (isTransferOutcome(log.outcome)) score += 8;
  if (event.src && phonesMatch(log.caller_id, event.src)) score += 12;
  if (
    event.uniqueid &&
    (log.sip_call_id === event.uniqueid || metadata.sip_call_id === event.uniqueid)
  ) {
    score += 30;
  }
  const started = Date.parse(log.started_at || log.created_at || "") || 0;
  if (started) {
    const ageMs = Math.abs(nowMs - started);
    if (ageMs <= 6 * 60 * 60 * 1000) score += 4;
    if (ageMs <= 30 * 60 * 1000) score += 4;
  }
  if (event.calltime) {
    const callMs = Date.parse(event.calltime) || 0;
    if (callMs && started && Math.abs(callMs - started) <= 15 * 60 * 1000) score += 6;
  }
  return score;
}

export function selectMatchingCallLog(
  logs: CallLogMatch[],
  event: MorCallEndEvent,
  nowMs = Date.now(),
): CallLogMatch | null {
  const ranked = logs
    .map((log) => ({ log, score: scoreCallLogMatch(log, event, nowMs) }))
    .filter((entry) => entry.score >= 8)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.log || null;
}

export function withAttachedRecordingMetadata(
  metadata: Record<string, unknown> | null | undefined,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  const current = isPlainObject(metadata) ? { ...metadata } : {};
  delete current.awaiting_post_transfer_recording;
  return {
    channel: "phone",
    ...current,
    post_transfer_recording_attached: true,
    post_transfer_recording_attached_at: extras.attachedAt || new Date().toISOString(),
    transfer_recording_provider: current.transfer_recording_provider || "mor_sip",
    ...extras,
  };
}

export function shouldResendSummaryEmailAfterTransferRecording(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const meta = isPlainObject(metadata) ? metadata : {};
  if (meta.summary_email_sent !== true) return false;
  const attachedAt = Date.parse(String(meta.post_transfer_recording_attached_at || ""));
  const sentAt = Date.parse(String(meta.summary_email_sent_at || ""));
  return Boolean(attachedAt && (!sentAt || attachedAt > sentAt));
}

export function formatDeepgramTranscript(payload: unknown): string {
  if (!isPlainObject(payload)) return "";
  const results = isPlainObject(payload.results) ? payload.results : {};
  const utterances = Array.isArray(results.utterances) ? results.utterances : [];
  if (utterances.length) {
    return utterances
      .map((entry) => {
        const row = isPlainObject(entry) ? entry : {};
        const speaker = row.speaker == null ? "speaker" : `speaker ${row.speaker}`;
        return `${speaker}: ${String(row.transcript || "").trim()}`;
      })
      .filter((line) => !line.endsWith(":"))
      .join("\n");
  }
  const channels = Array.isArray(results.channels) ? results.channels : [];
  const first = isPlainObject(channels[0]) ? channels[0] : {};
  const alternatives = Array.isArray(first.alternatives) ? first.alternatives : [];
  const alt = isPlainObject(alternatives[0]) ? alternatives[0] : {};
  return String(alt.transcript || "").trim();
}
