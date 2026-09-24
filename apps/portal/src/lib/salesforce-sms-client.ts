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
  const subject = input.direction === "inbound" ? "SMS reply" : "SMS sent";
  const response = await fetchImpl(`${input.access.instanceUrl}/services/data/v61.0/sobjects/Task`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.access.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      Subject: subject,
      Description: `${subject} with ${input.phone}\n\n${input.text}`.slice(0, 30000),
      WhoId: input.record.id,
      OwnerId: input.replyRoute.recipientId,
      Status: "Not Started",
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

export async function sendVonageSms(input: {
  apiKey: string;
  apiSecret: string;
  from: string;
  to: string;
  text: string;
  fetchImpl?: FetchLike;
}): Promise<{ messageId: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const from = input.from.replace(/\D/g, "");
  const to = input.to.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(from)) {
    throw new Error("SMS sender must be the phone number, not a name.");
  }
  const response = await fetchImpl("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: input.apiKey,
      api_secret: input.apiSecret,
      from,
      to,
      text: input.text,
    }),
    signal: AbortSignal.timeout(8000),
  });
  const payload = await response.json().catch(() => ({}));
  const message = payload?.messages?.[0];
  if (!response.ok || message?.status !== "0") {
    const errorText = typeof message?.["error-text"] === "string" ? message["error-text"] : "Vonage send failed.";
    throw new Error(errorText);
  }
  return { messageId: typeof message["message-id"] === "string" ? message["message-id"] : null };
}
