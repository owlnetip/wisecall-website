// Call session orchestrator, wires contact memory + integration webhooks into the
// before / during / after call lifecycle.

const { getSupabase } = require("./supabase");
const { loadContactContext, buildContextBlock, upsertContact } = require("./contactMemory");
const {
  runBeforeCallWebhooks,
  buildDuringCallTools,
  executeDuringCallWebhook,
  runAfterCallWebhooks,
} = require("./integrationWebhooks");
const { sendCallEmailSummary } = require("./emailSummary");
const { triggerPortalAnalysis } = require("./portalWebhook");
const { buildSystemPrompt } = require("../prompt");
const { saveCallLog, updateCallLogTranscript } = require("../saveCallLog");
const {
  isMorSipProfile,
  shouldDeferHangupSideEffects,
  mergeLiveAndRecordingTranscript,
  withAwaitingTransferMetadata,
  withAttachedRecordingMetadata,
} = require("./transferRecording");

async function isCallAllowed(profileId) {
  const sb = getSupabase();
  if (!sb) return true;

  try {
    const { data, error } = await sb.rpc("wisecall_call_allowed", {
      p_profile_id: profileId,
    });
    if (error) {
      console.error("[callSession] wisecall_call_allowed:", error.message);
      return true;
    }
    return data === true;
  } catch (err) {
    console.error("[callSession] wisecall_call_allowed:", err.message);
    return true;
  }
}

function indexIntegrationTools(toolDefs) {
  const byName = {};
  for (const def of toolDefs) {
    const name = def?.function?.name;
    if (name) byName[name] = def;
  }
  return byName;
}

/** Merge portal-configured during_call tools with built-in LLM tools. */
function mergeIntegrationTools(session, builtInTools = []) {
  const builtInNames = new Set(
    builtInTools.map((t) => t?.function?.name).filter(Boolean),
  );
  const integrationOnly = session.integrationTools.filter(
    (t) => !builtInNames.has(t?.function?.name),
  );
  return [...builtInTools, ...integrationOnly];
}

/**
 * Run at call connect, after loading the profile, before the LLM session starts.
 */
async function prepareCallSession(profile, { callId, callerId }) {
  const profileId = profile.id;
  const metadata = profile.metadata || {};
  const context = { profileId, callId, callerId };

  const allowed = await isCallAllowed(profileId);
  if (!allowed) {
    return { allowed: false, reason: "trial_cap" };
  }

  const [contactContext, pre] = await Promise.all([
    loadContactContext(profileId, { phone: callerId }),
    runBeforeCallWebhooks(metadata, context),
  ]);

  const contactBlock = buildContextBlock(contactContext);
  const systemPrompt = buildSystemPrompt(profile, {
    contactBlock,
    integrationBlock: pre.contextBlock,
    callerId,
  });

  const integrationTools = buildDuringCallTools(metadata, context);

  return {
    allowed: true,
    profile,
    contact: contactContext.contact,
    contactContext,
    context,
    systemPrompt,
    contactBlock,
    integrationBlock: pre.contextBlock,
    preCallResults: pre.results,
    integrationTools,
    integrationToolByName: indexIntegrationTools(integrationTools),
  };
}

/**
 * Route an LLM tool call. Returns null when the name is not a configured webhook.
 */
async function handleIntegrationToolCall(session, toolName, aiParams = {}) {
  const toolDef = session.integrationToolByName?.[toolName];
  if (!toolDef) return null;

  const result = await executeDuringCallWebhook(toolDef, aiParams);
  const content =
    typeof result.body === "string" ? result.body : JSON.stringify(result.body ?? {});

  return {
    tool: toolName,
    ok: result.ok,
    status: result.status,
    content,
    raw: result.body,
  };
}

/**
 * Run at hangup, persist the call log, update contact memory, fire after_call webhooks.
 */
function fireHangupSideEffects(profile, context, call, callLogId) {
  sendCallEmailSummary(profile, context, call)
    .then((result) => {
      if (result?.skipped) return;
      if (result && !result.ok) {
        console.error(
          "[callSession] email summary failed:",
          result.status,
          typeof result.body === "string" ? result.body : JSON.stringify(result.body),
        );
      }
    })
    .catch((err) => {
      console.error("[callSession] email summary failed:", err.message);
    });

  triggerPortalAnalysis(callLogId).catch((err) => {
    console.error("[callSession] portal analysis trigger failed:", err.message);
  });
}

async function finalizeCallSession(
  session,
  {
    transcript,
    summary,
    outcome,
    callerName,
    startedAt,
    finishedAt,
    metadata,
    recordingUrl,
    recordingDurationSec,
    sipCallId,
    endpointId,
  },
) {
  const profile = session.profile;
  const metadataProfile = profile.metadata || {};
  const context = {
    ...session.context,
    transcript: transcript || "",
    summary: summary || "",
  };

  const profileName =
    profile.profile_name || profile.business_name || profile.clinic_name || "Agent";
  const deferTransferRecording = shouldDeferHangupSideEffects(profile, outcome);
  const logMetadata = deferTransferRecording
    ? withAwaitingTransferMetadata(metadata)
    : { channel: "phone", ...(metadata || {}) };

  const callLogId = await saveCallLog({
    callId: session.context.callId,
    profileId: session.context.profileId,
    profileName,
    callerId: session.context.callerId,
    summary,
    outcome,
    transcript,
    startedAt,
    finishedAt,
    metadata: logMetadata,
    recordingUrl,
    recordingDurationSec,
    sipCallId,
    pbxType: isMorSipProfile(profile) ? "mor" : undefined,
    endpointId,
  });

  await upsertContact(session.context.profileId, {
    phone: session.context.callerId,
    name: callerName,
    aiSummary: summary,
    callLogId,
  });

  // Best-effort, don't block hangup on a slow customer endpoint.
  runAfterCallWebhooks(metadataProfile, context).catch((err) => {
    console.error("[callSession] after_call webhooks failed:", err.message);
  });

  // Telnyx already has the full recording at hangup. MOR SIP REFER ends the
  // bridge first — wait for the PBX recording before email/analysis.
  if (!deferTransferRecording) {
    fireHangupSideEffects(
      profile,
      session.context,
      { transcript, summary, outcome, startedAt, finishedAt, metadata: logMetadata },
      callLogId,
    );
  }

  return { callLogId, deferredPostTransfer: deferTransferRecording };
}

/**
 * Telephony host / MOR call-end webhook: attach the post-transfer recording
 * transcript (same outcome Telnyx already writes at hangup) and then fire the
 * after-call email + AI summary.
 */
async function attachPostTransferRecording(opts) {
  const sb = getSupabase();
  const callLogId = opts?.callLogId;
  if (!sb || !callLogId) return { ok: false, skipped: "missing_call_log" };

  const { data: log, error } = await sb
    .from("wisecall_call_logs")
    .select(
      "id, call_id, profile_id, profile_name, caller_id, summary, transcript, outcome, started_at, finished_at, metadata, recording_url",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!log) return { ok: false, skipped: "missing_call" };

  const mergedTranscript =
    opts.mergedTranscript ||
    mergeLiveAndRecordingTranscript(log.transcript, opts.recordingTranscript);
  const metadata = withAttachedRecordingMetadata(log.metadata, {
    mor_recording_id: opts.recordingId,
    mor_uniqueid: opts.uniqueid,
    recording_source: opts.recordingSource || "mor",
  });

  const updated = await updateCallLogTranscript(callLogId, {
    transcript: mergedTranscript,
    finishedAt: opts.finishedAt,
    recordingUrl: opts.recordingUrl || log.recording_url,
    recordingDurationSec: opts.recordingDurationSec,
    sipCallId: opts.uniqueid,
    metadata,
  });
  if (!updated) return { ok: false, error: "update_failed" };

  let profile = opts.profile;
  if (!profile && log.profile_id) {
    const { data } = await sb
      .from("wisecall_profiles")
      .select("id, slug, profile_name, business_name, clinic_name, receptionist_name, metadata")
      .eq("id", log.profile_id)
      .maybeSingle();
    profile = data;
  }

  if (profile) {
    fireHangupSideEffects(
      profile,
      {
        callId: log.call_id || sessionCallId(opts),
        callerId: log.caller_id,
        profileId: log.profile_id,
      },
      {
        transcript: mergedTranscript,
        summary: opts.summary || log.summary,
        outcome: opts.outcome || log.outcome,
        startedAt: log.started_at,
        finishedAt: opts.finishedAt || log.finished_at,
        metadata,
      },
      callLogId,
    );
  } else {
    triggerPortalAnalysis(callLogId).catch((err) => {
      console.error("[callSession] portal analysis trigger failed:", err.message);
    });
  }

  return { ok: true, callLogId, transcript: mergedTranscript };
}

function sessionCallId(opts) {
  return opts?.callId || "";
}

module.exports = {
  prepareCallSession,
  handleIntegrationToolCall,
  finalizeCallSession,
  attachPostTransferRecording,
  mergeIntegrationTools,
  isCallAllowed,
};
