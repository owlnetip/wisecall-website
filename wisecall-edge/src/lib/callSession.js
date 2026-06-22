// Call session orchestrator — wires contact memory + integration webhooks into the
// before / during / after call lifecycle.

const { getSupabase } = require("./supabase");
const { lookupContact, buildContextBlock, upsertContact } = require("./contactMemory");
const {
  runBeforeCallWebhooks,
  buildDuringCallTools,
  executeDuringCallWebhook,
  runAfterCallWebhooks,
} = require("./integrationWebhooks");
const { sendCallEmailSummary } = require("./emailSummary");
const { buildSystemPrompt } = require("../prompt");
const { saveCallLog } = require("../saveCallLog");

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
 * Run at call connect — after loading the profile, before the LLM session starts.
 */
async function prepareCallSession(profile, { callId, callerId }) {
  const profileId = profile.id;
  const metadata = profile.metadata || {};
  const context = { profileId, callId, callerId };

  const allowed = await isCallAllowed(profileId);
  if (!allowed) {
    return { allowed: false, reason: "trial_cap" };
  }

  const [contact, pre] = await Promise.all([
    lookupContact(profileId, callerId),
    runBeforeCallWebhooks(metadata, context),
  ]);

  const contactBlock = buildContextBlock(contact);
  const systemPrompt = buildSystemPrompt(profile, {
    contactBlock,
    integrationBlock: pre.contextBlock,
    callerId,
  });

  const integrationTools = buildDuringCallTools(metadata, context);

  return {
    allowed: true,
    profile,
    contact,
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
 * Run at hangup — persist the call log, update contact memory, fire after_call webhooks.
 */
async function finalizeCallSession(
  session,
  { transcript, summary, outcome, callerName, startedAt, finishedAt, metadata },
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
    metadata,
  });

  await upsertContact(session.context.profileId, {
    phone: session.context.callerId,
    name: callerName,
    aiSummary: summary,
    callLogId,
  });

  // Best-effort — don't block hangup on a slow customer endpoint.
  runAfterCallWebhooks(metadataProfile, context).catch((err) => {
    console.error("[callSession] after_call webhooks failed:", err.message);
  });

  // Best-effort — the standard customer summary email is independent of custom webhooks.
  sendCallEmailSummary(profile, session.context, {
    transcript,
    summary,
    outcome,
    startedAt,
    finishedAt,
    metadata,
  })
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

  return { callLogId };
}

module.exports = {
  prepareCallSession,
  handleIntegrationToolCall,
  finalizeCallSession,
  mergeIntegrationTools,
  isCallAllowed,
};
