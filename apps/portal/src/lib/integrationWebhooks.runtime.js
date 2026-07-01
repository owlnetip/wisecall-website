// integrationWebhooks.runtime.js - synced from wisecall-edge/src/lib/integrationWebhooks.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

// Per-agent custom webhooks - before_call, during_call, after_call.

const DEFAULT_TIMEOUT_MS = 8000;

function readWebhooks(metadata, condition) {
  const raw = metadata?.integration_webhooks;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (hook) =>
      hook &&
      hook.enabled !== false &&
      hook.condition === condition &&
      typeof hook.url === "string" &&
      hook.url.trim(),
  );
}

function substituteTemplates(value, context) {
  if (!value || typeof value !== "string") return value ?? "";
  return value
    .replace(/\{\{caller_id\}\}/g, context.callerId ?? "")
    .replace(/\{\{profile_id\}\}/g, context.profileId ?? "")
    .replace(/\{\{call_id\}\}/g, context.callId ?? "")
    .replace(/\{\{transcript\}\}/g, context.transcript ?? "")
    .replace(/\{\{summary\}\}/g, context.summary ?? "");
}

function buildPayload(parameters, context, aiParams) {
  const payload = { ...context };
  for (const param of parameters ?? []) {
    const key = (param.key || "").trim();
    if (!key) continue;
    const template = (param.value ?? "").trim();
    if (template) {
      payload[key] = substituteTemplates(template, context);
    } else if (aiParams && Object.prototype.hasOwnProperty.call(aiParams, key)) {
      payload[key] = aiParams[key];
    }
  }
  return payload;
}

function buildHeaders(headerRows) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  for (const row of headerRows ?? []) {
    const key = (row.key || "").trim();
    if (key) headers[key] = row.value ?? "";
  }
  return headers;
}

async function callWebhook(hook, context, aiParams) {
  const url = substituteTemplates(hook.url, context);
  const method = (hook.method || "POST").toUpperCase();
  const headers = buildHeaders(hook.headers);
  const payload = buildPayload(hook.parameters, context, aiParams);

  const init = {
    method,
    headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  };

  if (method === "GET" || method === "DELETE") {
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null && key !== "profileId" && key !== "callId") {
        qs.set(key, String(value));
      }
    }
    const joiner = url.includes("?") ? "&" : "?";
    const finalUrl = qs.toString() ? `${url}${joiner}${qs}` : url;
    const res = await fetch(finalUrl, init);
    const text = await res.text().catch(() => "");
    let body = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    return { ok: res.ok, status: res.status, body, hook: hook.name };
  }

  init.body = JSON.stringify(payload);
  const res = await fetch(url, init);
  const text = await res.text().catch(() => "");
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }
  return { ok: res.ok, status: res.status, body, hook: hook.name };
}

function formatContextBlock(results) {
  const lines = ["[INTEGRATION CONTEXT]"];
  for (const result of results) {
    if (!result.ok) {
      lines.push(`${result.hook}: request failed (${result.status})`);
      continue;
    }
    const body =
      typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
    lines.push(`${result.hook}:\n${body}`);
  }
  lines.push(
    "Use this integration data naturally in the conversation - do not read JSON verbatim.",
  );
  return lines.join("\n\n");
}

async function runBeforeCallWebhooks(metadata, context) {
  const hooks = readWebhooks(metadata, "before_call");
  if (!hooks.length) return { contextBlock: null, results: [] };

  const results = await Promise.all(
    hooks.map((hook) =>
      callWebhook(hook, context).catch((err) => ({
        ok: false,
        status: 0,
        body: err.message,
        hook: hook.name,
      })),
    ),
  );

  const anyOk = results.some((r) => r.ok);
  return {
    contextBlock: anyOk ? formatContextBlock(results) : null,
    results,
  };
}

function buildDuringCallTools(metadata, context) {
  return readWebhooks(metadata, "during_call").map((hook) => {
    const props = {};
    const required = [];
    for (const param of hook.parameters ?? []) {
      const key = (param.key || "").trim();
      if (!key) continue;
      const hasDefault = Boolean((param.value ?? "").trim());
      props[key] = {
        type: "string",
        description: hasDefault
          ? `Optional - defaults to ${param.value}`
          : "Extract from the conversation",
      };
      if (!hasDefault) required.push(key);
    }

    return {
      type: "function",
      function: {
        name: hook.name,
        description:
          hook.description ||
          hook.friendlyName ||
          `Call the ${hook.friendlyName || hook.name} integration`,
        parameters: {
          type: "object",
          properties: props,
          required,
        },
      },
      _webhook: hook,
      _context: context,
    };
  });
}

async function executeDuringCallWebhook(toolDef, aiParams) {
  const hook = toolDef._webhook;
  const context = toolDef._context ?? {};
  return callWebhook(hook, context, aiParams);
}

async function runAfterCallWebhooks(metadata, context) {
  const hooks = readWebhooks(metadata, "after_call");
  if (!hooks.length) return [];

  return Promise.all(
    hooks.map((hook) =>
      callWebhook(hook, context).catch((err) => ({
        ok: false,
        status: 0,
        body: err.message,
        hook: hook.name,
      })),
    ),
  );
}

module.exports = {
  runBeforeCallWebhooks,
  buildDuringCallTools,
  executeDuringCallWebhook,
  runAfterCallWebhooks,
  readWebhooks,
  substituteTemplates,
};
