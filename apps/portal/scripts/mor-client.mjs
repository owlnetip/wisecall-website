/**
 * MOR (Kolmisoft) API client for the latency test harness.
 * Reuses the same auth patterns as wisecall-provision-mor-agent.
 */

import crypto from "node:crypto";

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() || null;
}

function morError(xml) {
  return xmlTag(xml, "error") || xmlTag(xml, "e");
}

export function morSipDomain(morApiUrl) {
  try {
    return new URL(morApiUrl).hostname;
  } catch {
    return morApiUrl.replace(/^https?:\/\//, "").split("/")[0];
  }
}

export function sha1(message) {
  return crypto.createHash("sha1").update(message).digest("hex");
}

export async function morGet(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`MOR HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

export async function morPost(url, params) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`MOR HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

export function loadMorConfig() {
  const apiUrl = process.env.MOR_API_URL?.trim();
  const apiSecret = process.env.MOR_API_SECRET?.trim();
  const uniqueHash = process.env.MOR_UNIQUE_HASH?.trim();
  const username = process.env.MOR_WISECALL_RESELLER_USERNAME?.trim() || process.env.MOR_LATENCY_TEST_USER?.trim();
  const sipHost = process.env.MOR_SIP_DOMAIN?.trim() || (apiUrl ? morSipDomain(apiUrl) : "");
  const sipUser = process.env.MOR_LATENCY_TEST_SIP_USER?.trim();
  const sipPassword = process.env.MOR_LATENCY_TEST_SIP_PASSWORD?.trim();
  const sipPort = Number(process.env.MOR_SIP_PORT) || 5060;
  const deviceId = process.env.MOR_LATENCY_TEST_DEVICE_ID?.trim();

  return {
    apiUrl,
    apiSecret,
    uniqueHash,
    username,
    sipHost,
    sipUser,
    sipPassword,
    sipPort,
    deviceId,
  };
}

export function assertMorSipConfig(config) {
  const missing = [];
  if (!config.sipHost) missing.push("MOR_SIP_DOMAIN or MOR_API_URL");
  if (!config.sipUser) missing.push("MOR_LATENCY_TEST_SIP_USER");
  if (!config.sipPassword) missing.push("MOR_LATENCY_TEST_SIP_PASSWORD");
  if (missing.length) {
    throw new Error(
      `Missing MOR SIP test caller config: ${missing.join(", ")}. ` +
        "Register a dedicated latency-test SIP device on MOR and set its credentials.",
    );
  }
}

/** Normalise +441135222277 → 441135222277 for SIP Request-URI / MOR APIs. */
export function normaliseUkDid(number) {
  return String(number).replace(/[^\d]/g, "").replace(/^0/, "44");
}

/**
 * Poll MOR for a recent call matching source → destination.
 * Requires MOR_API_URL + credentials for calls_get.
 */
export async function findRecentMorCall(config, { src, dst, sinceIso }) {
  if (!config.apiUrl || !config.uniqueHash || !config.username) return null;

  const params = new URLSearchParams({
    u: config.username,
    hash: config.uniqueHash,
    period_start: Math.floor(new Date(sinceIso).getTime() / 1000).toString(),
    period_end: Math.floor(Date.now() / 1000).toString(),
  });

  const xml = await morGet(`${config.apiUrl}/billing/api/calls_get?${params.toString()}`);
  const err = morError(xml);
  if (err) {
    console.warn(`MOR calls_get: ${err}`);
    return null;
  }

  const blocks = xml.match(/<call>[\s\S]*?<\/call>/gi) || [];
  const srcNorm = normaliseUkDid(src);
  const dstNorm = normaliseUkDid(dst);

  for (const block of blocks.reverse()) {
    const source = (xmlTag(block, "src") || xmlTag(block, "clid") || "").replace(/[^\d]/g, "");
    const destination = (xmlTag(block, "dst") || xmlTag(block, "destination") || "").replace(/[^\d]/g, "");
    const uniqueid = xmlTag(block, "uniqueid") || xmlTag(block, "id");
    if (!uniqueid) continue;
    const srcMatch = source.endsWith(srcNorm.slice(-10)) || source.includes(srcNorm.slice(-9));
    const dstMatch = destination.endsWith(dstNorm.slice(-10)) || destination.includes(dstNorm.slice(-9));
    if (srcMatch && dstMatch) {
      return {
        uniqueid,
        source,
        destination,
        duration: xmlTag(block, "billsec") || xmlTag(block, "duration"),
      };
    }
  }
  return null;
}
