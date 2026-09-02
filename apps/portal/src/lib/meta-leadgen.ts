import { createHmac, timingSafeEqual } from "node:crypto";
import { toE164UkMobile } from "@/lib/uk-callback-number";

export const META_LEADGEN_SOURCE = "facebook_instant_form";
export const META_GRAPH_API_VERSION = "v25.0";

const PHONE_FIELD_NAMES = new Set([
  "phone_number",
  "phone",
  "mobile",
  "mobile_number",
  "mobile_phone",
  "cell_phone",
  "cellphone",
  "telephone",
  "tel",
  "your_mobile",
  "your_mobile_number",
  "uk_mobile",
  "uk_mobile_number",
]);

export type MetaLeadgenChange = {
  leadgenId: string;
  pageId: string;
  formId: string;
};

export type GraphLeadField = {
  name?: string;
  values?: unknown;
};

export type GraphLead = {
  id?: string;
  created_time?: string;
  field_data?: GraphLeadField[];
  error?: { message?: string; type?: string; code?: number };
};

export function getMetaVerifyToken() {
  return process.env.META_VERIFY_TOKEN?.trim() || "";
}

export function getMetaPageAccessToken() {
  return (
    process.env.META_PAGE_ACCESS_TOKEN?.trim() ||
    process.env.META_ACCESS_TOKEN?.trim() ||
    ""
  );
}

export function getMetaAppSecret() {
  return process.env.META_APP_SECRET?.trim() || "";
}

export function getMetaGraphApiVersion() {
  const configured = process.env.META_GRAPH_API_VERSION?.trim();
  return configured && /^v\d+\.\d+$/.test(configured)
    ? configured
    : META_GRAPH_API_VERSION;
}

export function readHubChallenge(searchParams: URLSearchParams): {
  mode: string;
  token: string;
  challenge: string;
} {
  return {
    mode: searchParams.get("hub.mode") || "",
    token: searchParams.get("hub.verify_token") || "",
    challenge: searchParams.get("hub.challenge") || "",
  };
}

export function metaHubChallengeResponse(
  searchParams: URLSearchParams,
  expectedToken = getMetaVerifyToken(),
): string | null {
  const { mode, token, challenge } = readHubChallenge(searchParams);
  if (mode !== "subscribe" || !challenge || !expectedToken) return null;
  if (token !== expectedToken) return null;
  return challenge;
}

export function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = getMetaAppSecret(),
): boolean {
  if (!appSecret) return true;
  const header = String(signatureHeader || "").trim();
  const prefix = "sha256=";
  if (!header.toLowerCase().startsWith(prefix)) return false;
  const provided = header.slice(prefix.length);
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  try {
    const a = Buffer.from(provided, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function extractLeadgenChanges(payload: unknown): MetaLeadgenChange[] {
  const root = asRecord(payload);
  if (!root) return [];
  const entries = Array.isArray(root.entry) ? root.entry : [];
  const found: MetaLeadgenChange[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const entryRecord = asRecord(entry);
    if (!entryRecord) continue;
    const changes = Array.isArray(entryRecord.changes) ? entryRecord.changes : [];
    for (const change of changes) {
      const changeRecord = asRecord(change);
      if (!changeRecord) continue;
      if (asString(changeRecord.field) && asString(changeRecord.field) !== "leadgen") {
        continue;
      }
      const value = asRecord(changeRecord.value);
      if (!value) continue;
      const leadgenId = asString(value.leadgen_id);
      if (!leadgenId || seen.has(leadgenId)) continue;
      seen.add(leadgenId);
      found.push({
        leadgenId,
        pageId: asString(value.page_id) || asString(entryRecord.id),
        formId: asString(value.form_id),
      });
    }
  }

  return found;
}

function fieldValues(field: GraphLeadField): string[] {
  if (!Array.isArray(field.values)) return [];
  return field.values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
}

function isPhoneFieldName(name: string): boolean {
  const key = name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PHONE_FIELD_NAMES.has(key)) return true;
  return /phone|mobile|cell/.test(key);
}

export function extractUkMobileFromFieldData(fieldData: unknown): string | null {
  if (!Array.isArray(fieldData)) return null;

  const named: string[] = [];
  const fallback: string[] = [];
  for (const raw of fieldData) {
    const field = asRecord(raw);
    if (!field) continue;
    const name = asString(field.name);
    const values = fieldValues(field as GraphLeadField);
    if (isPhoneFieldName(name)) named.push(...values);
    else fallback.push(...values);
  }

  for (const value of named) {
    const phone = toE164UkMobile(value);
    if (phone) return phone;
  }
  for (const value of fallback) {
    const phone = toE164UkMobile(value);
    if (phone) return phone;
  }
  return null;
}

export function graphLeadUrl(leadgenId: string, version = getMetaGraphApiVersion()): string {
  const id = encodeURIComponent(leadgenId);
  return `https://graph.facebook.com/${version}/${id}?fields=id,created_time,field_data`;
}

export async function fetchGraphLead(
  leadgenId: string,
  accessToken = getMetaPageAccessToken(),
  fetcher: typeof fetch = fetch,
): Promise<
  | { ok: true; lead: GraphLead }
  | { ok: false; error: string; status: number; retryable: boolean }
> {
  if (!accessToken) {
    return {
      ok: false,
      status: 503,
      retryable: false,
      error: "META_PAGE_ACCESS_TOKEN is not configured.",
    };
  }

  const url = graphLeadUrl(leadgenId);
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    signal: AbortSignal.timeout(8000),
  });
  const lead = (await response.json().catch(() => ({}))) as GraphLead;
  if (!response.ok || lead.error) {
    const status = response.status || 502;
    return {
      ok: false,
      status,
      retryable: status >= 500 || status === 429,
      error: lead.error?.message || "Could not fetch the Meta lead.",
    };
  }
  return { ok: true, lead };
}

export function metaLeadRateLimitIp(pageId: string): string {
  const id = pageId.trim() || "unknown-page";
  return `meta-leadgen:${id}`;
}
