// Telnyx keeps Call Control + recording after a mobile transfer, so the live
// STT transcript still covers the human leg. MOR SIP REFER drops the bridge
// from the media path, so STT stops at transfer. MOR can keep recording the
// SIP device through the PSTN leg; this module is the hook the hangup path
// already imports to wait for that recording and merge it into the log.

const POST_TRANSFER_MARKER = "--- After transfer ---";

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function routingFromProfile(profile) {
  const metadata = isPlainObject(profile?.metadata) ? profile.metadata : {};
  return isPlainObject(metadata.routing) ? metadata.routing : {};
}

function routingProvider(profile) {
  const metadata = isPlainObject(profile?.metadata) ? profile.metadata : {};
  const routing = routingFromProfile(profile);
  return String(routing.provider || metadata.routing_provider || "")
    .trim()
    .toLowerCase();
}

function isMorSipProfile(profile) {
  return routingProvider(profile) === "mor_sip";
}

function isTransferOutcome(outcome) {
  return /transfer/i.test(String(outcome || ""));
}

/**
 * MOR SIP transfers wait for the PBX recording unless a profile explicitly
 * turns it off. Telnyx is unchanged (Call Control already keeps the recording).
 */
function isPostTransferRecordingEnabled(profile) {
  const metadata = isPlainObject(profile?.metadata) ? profile.metadata : {};
  const routing = routingFromProfile(profile);
  if (routing.record_after_transfer === false || metadata.record_after_transfer === false) {
    return false;
  }
  return isMorSipProfile(profile);
}

function shouldDeferHangupSideEffects(profile, outcome) {
  return isPostTransferRecordingEnabled(profile) && isTransferOutcome(outcome);
}

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function phonesMatch(a, b) {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const tailLen = Math.min(10, left.length, right.length);
  if (tailLen < 9) return false;
  return left.slice(-tailLen) === right.slice(-tailLen);
}

function normalizeTranscript(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function mergeLiveAndRecordingTranscript(live, recording) {
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

function xmlTag(xml, tag) {
  const match = String(xml || "").match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.trim() || null;
}

function parseMorRecordingsXml(xml) {
  const blocks = String(xml || "").match(/<recording>[\s\S]*?<\/recording>/gi) || [];
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

function pickMorRecording(recordings, event = {}) {
  const rows = Array.isArray(recordings) ? recordings.filter(Boolean) : [];
  if (!rows.length) return null;

  const scored = rows
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

function firstString(...values) {
  for (const value of values) {
    if (value == null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function parseMorCallEndParams(input) {
  let params = input;
  if (typeof input === "string") {
    const raw = input.trim();
    if (!raw) return {};
    try {
      params = raw.includes("://")
        ? new URL(raw).searchParams
        : new URLSearchParams(raw.startsWith("?") ? raw.slice(1) : raw);
    } catch {
      params = new URLSearchParams(raw.replace(/^\?/, ""));
    }
  }

  const read = (key) => {
    if (!params) return "";
    if (typeof params.get === "function") return firstString(params.get(key));
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

function morCallEndWebhookUrl(supabaseUrl, token) {
  const base = String(supabaseUrl || "")
    .trim()
    .replace(/\/+$/, "");
  if (!base) return "";
  const url = new URL(`${base}/functions/v1/wisecall-mor-call-end`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function scoreCallLogMatch(log, event, nowMs = Date.now()) {
  if (!log) return -1;
  const metadata = isPlainObject(log.metadata) ? log.metadata : {};
  let score = 0;

  if (metadata.awaiting_post_transfer_recording === true) score += 20;
  if (isTransferOutcome(log.outcome)) score += 8;
  if (event.src && phonesMatch(log.caller_id, event.src)) score += 12;
  if (event.uniqueid && (log.sip_call_id === event.uniqueid || metadata.sip_call_id === event.uniqueid)) {
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

function selectMatchingCallLog(logs, event, nowMs = Date.now()) {
  const rows = Array.isArray(logs) ? logs.filter(Boolean) : [];
  if (!rows.length) return null;
  const ranked = rows
    .map((log) => ({ log, score: scoreCallLogMatch(log, event, nowMs) }))
    .filter((entry) => entry.score >= 8)
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.log || null;
}

function withAwaitingTransferMetadata(metadata, extras = {}) {
  return {
    channel: "phone",
    ...(isPlainObject(metadata) ? metadata : {}),
    awaiting_post_transfer_recording: true,
    transfer_recording_provider: "mor_sip",
    ...extras,
  };
}

function withAttachedRecordingMetadata(metadata, extras = {}) {
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

function shouldResendSummaryEmailAfterTransferRecording(metadata) {
  const meta = isPlainObject(metadata) ? metadata : {};
  if (meta.summary_email_sent !== true) return false;
  const attachedAt = Date.parse(String(meta.post_transfer_recording_attached_at || ""));
  const sentAt = Date.parse(String(meta.summary_email_sent_at || ""));
  return Boolean(attachedAt && (!sentAt || attachedAt > sentAt));
}

function formatDeepgramTranscript(payload) {
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

module.exports = {
  POST_TRANSFER_MARKER,
  isMorSipProfile,
  isTransferOutcome,
  isPostTransferRecordingEnabled,
  shouldDeferHangupSideEffects,
  phoneDigits,
  phonesMatch,
  mergeLiveAndRecordingTranscript,
  parseMorRecordingsXml,
  pickMorRecording,
  parseMorCallEndParams,
  morCallEndWebhookUrl,
  scoreCallLogMatch,
  selectMatchingCallLog,
  withAwaitingTransferMetadata,
  withAttachedRecordingMetadata,
  shouldResendSummaryEmailAfterTransferRecording,
  formatDeepgramTranscript,
};
