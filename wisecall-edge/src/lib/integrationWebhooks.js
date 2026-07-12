// Per-agent custom webhooks, before_call, during_call, after_call.

const { lookup } = require("node:dns").promises;
const { BlockList, isIP } = require("node:net");

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");
const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["::ffff:0:0", 96],
]) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const blockedHostSuffixes = [
  ".arpa",
  ".example",
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
];

function cleanHostname(hostname) {
  return String(hostname || "")
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

function isPublicAddress(address) {
  const clean = cleanHostname(address).replace(/%[^%]+$/, "");
  const family = isIP(clean);
  if (family === 4) return !blockedIpv4.check(clean, "ipv4");
  if (family === 6) {
    return publicIpv6.check(clean, "ipv6") && !blockedIpv6.check(clean, "ipv6");
  }
  return false;
}

async function defaultResolver(hostname) {
  return lookup(hostname, { all: true, verbatim: true });
}

async function assertPublicWebhookUrl(value, resolver = defaultResolver) {
  let url;
  try {
    url = value instanceof URL ? new URL(value) : new URL(String(value));
  } catch {
    throw new Error("Integration endpoint is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Integration endpoint must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    throw new Error("Integration endpoint cannot include credentials in the URL");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new Error("Integration endpoint must use a standard HTTP or HTTPS port");
  }

  const hostname = cleanHostname(url.hostname);
  const blockedHostname =
    !hostname ||
    hostname === "localhost" ||
    (!hostname.includes(".") && isIP(hostname) === 0) ||
    blockedHostSuffixes.some(
      (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
    );
  if (blockedHostname) throw new Error("Integration endpoint must be public");

  if (isIP(hostname)) {
    if (!isPublicAddress(hostname)) throw new Error("Integration endpoint must be public");
    return url;
  }

  let addresses;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new Error("Integration endpoint hostname could not be resolved");
  }
  if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error("Integration endpoint must be public");
  }
  return url;
}

async function fetchWebhookUrl(initialUrl, init = {}, options = {}) {
  const resolver = options.resolver || defaultResolver;
  const fetcher = options.fetcher || fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = await assertPublicWebhookUrl(initialUrl, resolver);
  let currentInit = { ...init, redirect: "manual" };

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetcher(currentUrl, currentInit);
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new Error("Integration endpoint returned an invalid redirect");
    if (redirectCount === maxRedirects) throw new Error("Integration endpoint redirected too many times");
    currentUrl = await assertPublicWebhookUrl(new URL(location, currentUrl), resolver);
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && currentInit.method === "POST")
    ) {
      const { body: _body, ...withoutBody } = currentInit;
      currentInit = { ...withoutBody, method: "GET", redirect: "manual" };
    }
  }
  throw new Error("Integration endpoint redirected too many times");
}

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
  const forbidden = new Set(["connection", "content-length", "host", "transfer-encoding"]);
  for (const row of headerRows ?? []) {
    const key = (row.key || "").trim();
    if (key && !forbidden.has(key.toLowerCase())) headers[key] = row.value ?? "";
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
    const res = await fetchWebhookUrl(finalUrl, init);
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
  const res = await fetchWebhookUrl(url, init);
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
    "Use this integration data naturally in the conversation, do not read JSON verbatim.",
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
          ? `Optional, defaults to ${param.value}`
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
  buildHeaders,
  assertPublicWebhookUrl,
  fetchWebhookUrl,
};
