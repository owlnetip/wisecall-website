import {
  assertSalesforceInstanceUrl,
  buildPhoneSosl,
  parseSalesforceSearchRecords,
  type ResolvedReplyRoute,
  type SalesforceSmsEnv,
  type SalesforceSmsRecord,
} from "@/lib/salesforce-sms";

type FetchLike = typeof fetch;

export type SalesforceAccess = {
  accessToken: string;
  instanceUrl: string;
};

let tokenCache: { key: string; access: SalesforceAccess; expiresAt: number } | null = null;

export function resetSalesforceTokenCache() {
  tokenCache = null;
}

export async function requestSalesforceToken(
  config: SalesforceSmsEnv,
  fetchImpl: FetchLike = fetch,
): Promise<SalesforceAccess> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (config.refreshToken) {
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", config.refreshToken);
  } else {
    body.set("grant_type", "client_credentials");
  }

  const response = await fetchImpl(`${config.instanceUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof payload?.error_description === "string"
        ? payload.error_description
        : "Salesforce token request failed.";
    throw new Error(message);
  }

  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const instanceUrl =
    typeof payload.instance_url === "string" && payload.instance_url
      ? payload.instance_url.replace(/\/+$/, "")
      : config.instanceUrl;
  if (!accessToken) throw new Error("Salesforce token response did not include an access token.");
  assertSalesforceInstanceUrl(instanceUrl);
  return { accessToken, instanceUrl };
}

export async function getSalesforceAccess(
  config: SalesforceSmsEnv,
  fetchImpl: FetchLike = fetch,
): Promise<SalesforceAccess> {
  const key = `${config.instanceUrl}:${config.clientId}:${config.refreshToken ? "refresh" : "client"}`;
  if (tokenCache && tokenCache.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.access;
  }
  const access = await requestSalesforceToken(config, fetchImpl);
  tokenCache = { key, access, expiresAt: Date.now() + 50 * 60 * 1000 };
  return access;
}

export async function lookupSalesforceByPhone(input: {
  access: SalesforceAccess;
  digits: string;
  fetchImpl?: FetchLike;
}): Promise<SalesforceSmsRecord[]> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const sosl = buildPhoneSosl(input.digits);
  const url = new URL(`${input.access.instanceUrl}/services/data/v61.0/search/`);
  url.searchParams.set("q", sosl);
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${input.access.accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(salesforceErrorMessage(payload, "Salesforce number lookup failed."));
  }
  return parseSalesforceSearchRecords(payload, input.digits);
}

export async function createSalesforceSmsTask(input: {
  access: SalesforceAccess;
  record: SalesforceSmsRecord;
  replyRoute: ResolvedReplyRoute;
  phone: string;
  text: string;
  direction: "outbound" | "inbound";
  fetchImpl?: FetchLike;
}): Promise<{ taskId: string | null; error: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  // Logged like a 3CX call: a completed activity in the timeline history, with
  // the message itself in the title so the conversation reads down the record.
  const label = input.direction === "inbound" ? "SMS received" : "SMS sent";
  const snippet = input.text.replace(/\s+/g, " ").trim();
  const subject = `${label}: ${snippet.length > 80 ? `${snippet.slice(0, 79)}…` : snippet}`;
  const response = await fetchImpl(`${input.access.instanceUrl}/services/data/v61.0/sobjects/Task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.access.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Subject: subject,
      Description: `${label} ${input.direction === "inbound" ? "from" : "to"} ${input.phone}\n\n${input.text}`.slice(0, 30000),
      WhoId: input.record.id,
      OwnerId: input.replyRoute.recipientId,
      Status: "Completed",
      Priority: "Normal",
      ActivityDate: new Date().toISOString().slice(0, 10),
    }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { taskId: null, error: salesforceErrorMessage(payload, "Salesforce task create failed.") };
  }
  const taskId = typeof payload.id === "string" ? payload.id : null;
  return { taskId, error: taskId ? null : "Salesforce task response did not include an id." };
}

function salesforceErrorMessage(payload: unknown, fallback: string): string {
  if (Array.isArray(payload) && typeof payload[0]?.message === "string") return payload[0].message;
  if (payload && typeof payload === "object" && typeof (payload as { message?: unknown }).message === "string") {
    return (payload as { message: string }).message;
  }
  return fallback;
}

const REPLY_NOTIFICATION_TYPE = "WiseCall_SMS_Reply";
let replyNotificationTypeId: string | null = null;

// Bell notification to whoever replies are routed to, so a text logged as a
// completed activity still gets seen. Best effort: never fails the reply.
export async function sendSalesforceReplyNotification(input: {
  access: SalesforceAccess;
  recipientId: string;
  targetId: string;
  recordName: string;
  text: string;
  fetchImpl?: FetchLike;
}): Promise<{ sent: boolean; error: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const base = `${input.access.instanceUrl}/services/data/v61.0`;
  const headers = { Authorization: `Bearer ${input.access.accessToken}`, "Content-Type": "application/json" };
  try {
    if (!replyNotificationTypeId) {
      const q = encodeURIComponent(`SELECT Id FROM CustomNotificationType WHERE DeveloperName = '${REPLY_NOTIFICATION_TYPE}'`);
      // Integration users cannot query this type via the data API, only Tooling.
      const res = await fetchImpl(`${base}/tooling/query?q=${q}`, { headers, signal: AbortSignal.timeout(8000) });
      const payload = await res.json().catch(() => ({}));
      const id = payload?.records?.[0]?.Id;
      if (!res.ok || typeof id !== "string") return { sent: false, error: "Reply notification type not found in Salesforce." };
      replyNotificationTypeId = id;
    }
    const snippet = input.text.replace(/\s+/g, " ").trim();
    const res = await fetchImpl(`${base}/actions/standard/customNotificationAction`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        inputs: [{
          customNotifTypeId: replyNotificationTypeId,
          recipientIds: [input.recipientId],
          title: `SMS reply from ${input.recordName}`.slice(0, 250),
          body: (snippet.length > 300 ? `${snippet.slice(0, 299)}…` : snippet) || "(empty message)",
          targetId: input.targetId,
        }],
      }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await res.json().catch(() => null);
    const ok = res.ok && Array.isArray(payload) && payload[0]?.isSuccess === true;
    return ok
      ? { sent: true, error: null }
      : { sent: false, error: salesforceErrorMessage(Array.isArray(payload) ? payload[0]?.errors : payload, "Salesforce notification failed.") };
  } catch (error) {
    return { sent: false, error: error instanceof Error ? error.message : String(error) };
  }
}
