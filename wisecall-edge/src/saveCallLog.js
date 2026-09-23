// Persists a completed phone call to wisecall_call_logs.

const { getSupabase } = require("./lib/supabase");

async function saveCallLog({
  callId,
  profileId,
  profileName,
  callerId,
  summary,
  outcome,
  transcript,
  startedAt,
  finishedAt,
  metadata,
  recordingUrl,
  recordingDurationSec,
  sipCallId,
  pbxType,
  endpointId,
}) {
  const sb = getSupabase();
  if (!sb) {
    console.error("[saveCallLog] Supabase not configured");
    return null;
  }

  const now = new Date().toISOString();
  const row = {
    call_id: callId,
    profile_id: profileId,
    profile_name: profileName || null,
    caller_id: callerId || null,
    summary: summary || null,
    outcome: outcome || null,
    transcript: transcript || null,
    started_at: startedAt || now,
    finished_at: finishedAt || now,
    metadata: { channel: "phone", ...(metadata || {}) },
  };
  if (recordingUrl) row.recording_url = recordingUrl;
  if (recordingDurationSec != null && recordingDurationSec !== "") {
    row.recording_duration_sec = Number(recordingDurationSec) || null;
  }
  if (sipCallId) row.sip_call_id = sipCallId;
  if (pbxType) row.pbx_type = pbxType;
  if (endpointId) row.endpoint_id = endpointId;

  try {
    const { data, error } = await sb
      .from("wisecall_call_logs")
      .insert(row)
      .select("id")
      .single();

    if (error) {
      console.error("[saveCallLog] insert failed:", error.message);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("[saveCallLog] error:", err.message);
    return null;
  }
}

async function updateCallLogTranscript(callLogId, patch) {
  const sb = getSupabase();
  if (!sb || !callLogId) return null;

  const row = {};
  if (patch.transcript != null) row.transcript = patch.transcript;
  if (patch.summary != null) row.summary = patch.summary;
  if (patch.outcome != null) row.outcome = patch.outcome;
  if (patch.finishedAt != null) row.finished_at = patch.finishedAt;
  if (patch.recordingUrl != null) row.recording_url = patch.recordingUrl;
  if (patch.recordingDurationSec != null) {
    row.recording_duration_sec = Number(patch.recordingDurationSec) || null;
  }
  if (patch.sipCallId != null) row.sip_call_id = patch.sipCallId;
  if (patch.metadata != null) row.metadata = patch.metadata;

  if (!Object.keys(row).length) return callLogId;

  try {
    const { error } = await sb.from("wisecall_call_logs").update(row).eq("id", callLogId);
    if (error) {
      console.error("[saveCallLog] update failed:", error.message);
      return null;
    }
    return callLogId;
  } catch (err) {
    console.error("[saveCallLog] update error:", err.message);
    return null;
  }
}

module.exports = { saveCallLog, updateCallLogTranscript };
