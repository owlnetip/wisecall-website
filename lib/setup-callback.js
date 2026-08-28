/**
 * Public /setup demo callback: collect a website + UK mobile, then fire the
 * existing WiseCall test-agent outbound callback (profile_slug "wisecall").
 *
 * Website is stored for analytics only. The live demo is the shared test
 * agent (same as +44 113 522 2277). It does not answer in the visitor's name.
 */
import { createHash } from "node:crypto";

export const SETUP_CALLBACK_SOURCE = "wisecall_setup_landing";

export const DEFAULT_PORTAL_CALLBACK_URL =
  "https://app.wisecall.io/api/demo-callback";

export const DEFAULT_EDGE_CALLBACK_URL =
  "https://zgzzpwaqqftmugzpccpm.supabase.co/functions/v1/wisecall-demo-callback";

export const DEMO_CALLBACK_IP_LIMIT = 5;
export const DEMO_CALLBACK_IP_WINDOW_SECONDS = 15 * 60;
export const DEMO_CALLBACK_NUMBER_LIMIT = 3;
export const DEMO_CALLBACK_NUMBER_WINDOW_SECONDS = 60 * 60;

const MAX_WEBSITE_LENGTH = 300;

export function parseSetupWebsite(input) {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw || raw.length > MAX_WEBSITE_LENGTH) return null;
  if (/[\s<>]/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (!host || host === "localhost" || !host.includes(".")) return null;

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function websiteHost(website) {
  try {
    return new URL(website).hostname.replace(/\.$/, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Accept UK mobiles as 07…, +44 7…, 0044 7…, or 447….
 * Matches the homepage demo form: 07 + 9 digits (or 447 + 9).
 * Returns E.164 (+447…).
 */
export function parseUkMobile(input) {
  if (typeof input !== "string") {
    return { ok: false, error: "Enter a UK mobile number so we can call you." };
  }

  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 32) {
    return { ok: false, error: "Enter a UK mobile number so we can call you." };
  }

  let digits = trimmed.replace(/\D+/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;

  if (!/^447\d{9}$/.test(digits)) {
    return { ok: false, error: "Enter a UK mobile number so we can call you." };
  }

  return { ok: true, e164: `+${digits}`, digits };
}

export function getCallbackClientIp(headers) {
  const read = (name) => {
    if (!headers) return "";
    if (typeof headers.get === "function") return headers.get(name) || "";
    const direct = headers[name] || headers[name.toLowerCase()];
    if (Array.isArray(direct)) return direct[0] || "";
    return direct || "";
  };

  const forwarded =
    read("x-vercel-forwarded-for") ||
    read("x-forwarded-for") ||
    read("x-real-ip") ||
    "unknown";
  return String(forwarded).split(",")[0]?.trim().slice(0, 128) || "unknown";
}

export function createCallbackRateLimitKey(kind, value) {
  const digest = createHash("sha256").update(`${kind}:${value}`).digest("hex");
  return `${kind}:${digest}`;
}

export function createRateLimiter(now = () => Date.now()) {
  const buckets = new Map();

  function consume(key, limit, windowSeconds) {
    const windowMs = windowSeconds * 1000;
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || t - bucket.startedAt >= windowMs) {
      bucket = { startedAt: t, count: 0 };
    }
    bucket.count += 1;
    buckets.set(key, bucket);

    if (buckets.size > 4000) {
      for (const [k, v] of buckets) {
        if (t - v.startedAt >= windowMs) buckets.delete(k);
      }
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((bucket.startedAt + windowMs - t) / 1000),
    );
    return {
      allowed: bucket.count <= limit,
      retryAfterSeconds,
    };
  }

  return { consume, buckets };
}

export const setupCallbackLimiter = createRateLimiter();

function jsonResponse(status, body, extraHeaders = {}) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Robots-Tag": "noindex, follow",
    ...extraHeaders,
  };
  return { status, body, headers };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    if (!req.body.trim()) return {};
    return JSON.parse(req.body);
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function parseResponseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function postJson(fetchImpl, url, payload, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const result = await parseResponseJson(response);
    return { response, result };
  } finally {
    clearTimeout(timer);
  }
}

function portalPlacedCall(status) {
  return status >= 200 && status < 300;
}

function portalShouldFallback(status) {
  return !status || status >= 500;
}

export async function runSetupCallback(req, opts = {}) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const limiter = opts.limiter || setupCallbackLimiter;
  const portalUrl =
    opts.portalUrl ||
    process.env.WISECALL_PORTAL_DEMO_CALLBACK_URL ||
    DEFAULT_PORTAL_CALLBACK_URL;
  const edgeUrl =
    opts.edgeUrl ||
    process.env.WISECALL_DEMO_CALLBACK_ENDPOINT ||
    DEFAULT_EDGE_CALLBACK_URL;
  const timeoutMs = opts.timeoutMs || 12000;

  const method = String(req.method || "GET").toUpperCase();
  if (method === "OPTIONS") {
    return jsonResponse(204, null);
  }
  if (method !== "POST") {
    return jsonResponse(
      405,
      { ok: false, error: "Use POST to request a demo call." },
      { Allow: "POST, OPTIONS" },
    );
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch {
    return jsonResponse(400, { ok: false, error: "Send a JSON body." });
  }

  const website = parseSetupWebsite(payload?.website);
  if (!website) {
    return jsonResponse(400, {
      ok: false,
      error: "Enter a website, like yourwebsite.co.uk",
    });
  }

  const mobile = parseUkMobile(payload?.phone);
  if (!mobile.ok) {
    return jsonResponse(400, { ok: false, error: mobile.error });
  }

  const ip = getCallbackClientIp(req.headers);
  const ipLimit = limiter.consume(
    createCallbackRateLimitKey("setup-ip", ip),
    DEMO_CALLBACK_IP_LIMIT,
    DEMO_CALLBACK_IP_WINDOW_SECONDS,
  );
  const numberLimit = limiter.consume(
    createCallbackRateLimitKey("setup-number", mobile.digits),
    DEMO_CALLBACK_NUMBER_LIMIT,
    DEMO_CALLBACK_NUMBER_WINDOW_SECONDS,
  );

  if (!ipLimit.allowed || !numberLimit.allowed) {
    const retryAfterSeconds = Math.max(
      ipLimit.allowed ? 0 : ipLimit.retryAfterSeconds,
      numberLimit.allowed ? 0 : numberLimit.retryAfterSeconds,
    );
    return jsonResponse(
      429,
      {
        ok: false,
        error: "Too many demo calls have been requested. Please wait before trying again.",
      },
      { "Retry-After": String(retryAfterSeconds) },
    );
  }

  const host = websiteHost(website);
  console.info(
    "setup-callback",
    JSON.stringify({
      source: SETUP_CALLBACK_SOURCE,
      website_host: host,
    }),
  );

  const portalPayload = {
    phone: mobile.e164,
    source: SETUP_CALLBACK_SOURCE,
    website,
  };

  try {
    const { response, result } = await postJson(
      fetchImpl,
      portalUrl,
      portalPayload,
      timeoutMs,
    );
    if (portalPlacedCall(response.status)) {
      return jsonResponse(200, {
        ok: true,
        message: result.message || "The WiseCall test agent is calling now.",
      });
    }
    if (!portalShouldFallback(response.status)) {
      const status = response.status === 429 ? 429 : response.status || 400;
      const extra =
        status === 429 && response.headers?.get
          ? { "Retry-After": response.headers.get("Retry-After") || "60" }
          : {};
      return jsonResponse(
        status,
        {
          ok: false,
          error:
            result.error ||
            (status === 429
              ? "Too many demo calls have been requested. Please wait before trying again."
              : "Could not start the demo call."),
        },
        extra,
      );
    }
  } catch (error) {
    console.error(
      "setup-callback portal failed",
      error instanceof Error ? error.message : error,
    );
  }

  try {
    const { response, result } = await postJson(
      fetchImpl,
      edgeUrl,
      {
        phone: mobile.e164,
        profile_slug: "wisecall",
        agent_name: "WiseCall Website Assistant",
        source: SETUP_CALLBACK_SOURCE,
      },
      timeoutMs,
    );

    if (!response.ok || result.ok === false) {
      return jsonResponse(response.status || 502, {
        ok: false,
        error: result.error || "Could not start the demo call.",
      });
    }

    return jsonResponse(200, {
      ok: true,
      message: result.message || "The WiseCall test agent is calling now.",
    });
  } catch (error) {
    console.error(
      "setup-callback edge failed",
      error instanceof Error ? error.message : error,
    );
    return jsonResponse(503, {
      ok: false,
      error: "Demo calls are temporarily unavailable. Please try again shortly.",
    });
  }
}

export function applySetupCallbackResult(res, result) {
  for (const [key, value] of Object.entries(result.headers || {})) {
    if (value != null) res.setHeader(key, value);
  }
  res.status(result.status);
  if (result.status === 204 || result.body == null) {
    res.send("");
    return;
  }
  res.send(JSON.stringify(result.body));
}
