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

module.exports = { saveCallLog };
