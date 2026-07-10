// Per-agent custom integration webhooks, before, during and after a call.
// Stored on wisecall_profiles.metadata.integration_webhooks and read by the
// voice runtime (integrationWebhooks.runtime.js).

export type WebhookCondition = "before_call" | "during_call" | "after_call";

export type WebhookHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type WebhookKeyValue = {
  key: string;
  value: string;
};

export type IntegrationWebhook = {
  id: string;
  /** Machine name used as the during-call tool id (e.g. lookup_patient). */
  name: string;
  /** Label shown in the portal. */
  friendlyName: string;
  /** Helps the AI decide when to invoke a during-call webhook. */
  description: string;
  condition: WebhookCondition;
  method: WebhookHttpMethod;
  url: string;
  enabled: boolean;
  headers: WebhookKeyValue[];
  /** Empty value = AI extracts from the conversation at runtime. */
  parameters: WebhookKeyValue[];
  /** Last explicit test sent from the portal. This is not a live uptime claim. */
  lastTestedAt?: string;
  lastTestOk?: boolean;
  lastTestStatus?: number;
  lastTestError?: string;
};

export type WebhookVerificationState = "disabled" | "untested" | "passing" | "failing";

export const webhookConditions: {
  value: WebhookCondition;
  label: string;
  blurb: string;
}[] = [
  {
    value: "before_call",
    label: "Before call",
    blurb: "Runs when a call connects, before the agent speaks: pre-fetch caller or CRM data.",
  },
  {
    value: "during_call",
    label: "During call",
    blurb: "Exposed as a tool the agent can call mid-conversation (bookings, tickets, lookups).",
  },
  {
    value: "after_call",
    label: "After call",
    blurb: "Fires when the call ends, log to CRM, send summaries, trigger workflows.",
  },
];

export const webhookMethods: WebhookHttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
];

/** Runtime template tokens substituted into parameter values. */
export const webhookTemplateTokens = [
  { token: "{{caller_id}}", label: "Caller phone number" },
  { token: "{{profile_id}}", label: "Agent profile id" },
  { token: "{{call_id}}", label: "Call id" },
  { token: "{{transcript}}", label: "Full transcript (after call)" },
  { token: "{{summary}}", label: "AI summary (after call)" },
];

export function substituteWebhookTemplates(
  value: string,
  context: Record<string, string>,
): string {
  return value.replace(/\{\{([a-z_]+)\}\}/g, (token, key: string) => context[key] ?? token);
}

export function slugifyWebhookName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
}

export function newIntegrationWebhook(
  partial?: Partial<IntegrationWebhook>,
): IntegrationWebhook {
  const friendlyName = partial?.friendlyName?.trim() || "New integration";
  return {
    id: partial?.id ?? crypto.randomUUID(),
    name: partial?.name?.trim() || slugifyWebhookName(friendlyName) || "webhook",
    friendlyName,
    description: partial?.description ?? "",
    condition: partial?.condition ?? "after_call",
    method: partial?.method ?? "POST",
    url: partial?.url ?? "",
    enabled: partial?.enabled !== false,
    headers: partial?.headers ?? [],
    parameters: partial?.parameters ?? [],
    lastTestedAt: partial?.lastTestedAt,
    lastTestOk: partial?.lastTestOk,
    lastTestStatus: partial?.lastTestStatus,
    lastTestError: partial?.lastTestError,
  };
}

export function webhookVerificationState(hook: IntegrationWebhook): WebhookVerificationState {
  if (!hook.enabled) return "disabled";
  if (!hook.lastTestedAt || hook.lastTestOk === undefined) return "untested";
  return hook.lastTestOk ? "passing" : "failing";
}

function webhookTestFingerprint(hook: IntegrationWebhook): string {
  return JSON.stringify({
    name: slugifyWebhookName(hook.name),
    condition: hook.condition,
    method: hook.method,
    url: hook.url.trim(),
    headers: hook.headers.map((row) => ({ key: row.key.trim().toLowerCase(), value: row.value })),
    parameters: hook.parameters.map((row) => ({ key: row.key.trim(), value: row.value })),
  });
}

export function hasSameWebhookExecutionConfig(
  first: IntegrationWebhook,
  second: IntegrationWebhook,
): boolean {
  return webhookTestFingerprint(first) === webhookTestFingerprint(second);
}

export function mergeStoredWebhookTestEvidence(
  webhooks: IntegrationWebhook[],
  storedWebhooks: IntegrationWebhook[],
): IntegrationWebhook[] {
  const storedById = new Map(storedWebhooks.map((hook) => [hook.id, hook]));
  return webhooks.map((hook) => {
    const stored = storedById.get(hook.id);
    if (!stored || !hasSameWebhookExecutionConfig(stored, hook)) {
      return {
        ...hook,
        lastTestedAt: undefined,
        lastTestOk: undefined,
        lastTestStatus: undefined,
        lastTestError: undefined,
      };
    }
    return {
      ...hook,
      lastTestedAt: stored.lastTestedAt,
      lastTestOk: stored.lastTestOk,
      lastTestStatus: stored.lastTestStatus,
      lastTestError: stored.lastTestError,
    };
  });
}

export function validateIntegrationWebhooks(webhooks: IntegrationWebhook[]): string | null {
  if (webhooks.length > 10) return "You can configure up to 10 custom integrations per agent.";

  const enabledNames = new Set<string>();
  for (const [index, hook] of webhooks.entries()) {
    if (!hook.enabled) continue;
    const label = hook.friendlyName.trim() || `Integration ${index + 1}`;
    const name = slugifyWebhookName(hook.name);
    if (!name) return `${label} needs a tool name.`;
    if (!hook.url.trim()) return `${label} needs an endpoint URL.`;
    if (enabledNames.has(name)) return `Each enabled integration needs a unique tool name. “${name}” is used more than once.`;
    enabledNames.add(name);

    const headerNames = new Set<string>();
    for (const header of hook.headers) {
      const key = header.key.trim().toLowerCase();
      if (!key) continue;
      if (["connection", "content-length", "host", "transfer-encoding"].includes(key)) {
        return `${label} cannot set the ${header.key.trim()} header.`;
      }
      if (headerNames.has(key)) return `${label} has the ${header.key.trim()} header more than once.`;
      headerNames.add(key);
    }
  }
  return null;
}

function readKeyValues(raw: unknown): WebhookKeyValue[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const key = typeof row.key === "string" ? row.key.trim() : "";
      const value = typeof row.value === "string" ? row.value : "";
      return key ? { key, value } : null;
    })
    .filter((item): item is WebhookKeyValue => item !== null);
}

export function readIntegrationWebhooks(metadata: Record<string, unknown> | null): IntegrationWebhook[] {
  const raw = metadata?.integration_webhooks;
  if (!Array.isArray(raw)) return [];

  return raw
    .map<IntegrationWebhook | null>((item, index) => {
      const row = (item ?? {}) as Record<string, unknown>;
      const friendlyName =
        typeof row.friendlyName === "string"
          ? row.friendlyName
          : typeof row.friendly_name === "string"
            ? row.friendly_name
            : "";
      const condition = row.condition;
      const method = row.method;

      if (
        condition !== "before_call" &&
        condition !== "during_call" &&
        condition !== "after_call"
      ) {
        return null;
      }
      if (
        method !== "GET" &&
        method !== "POST" &&
        method !== "PUT" &&
        method !== "PATCH" &&
        method !== "DELETE"
      ) {
        return null;
      }

      const name =
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim()
          : slugifyWebhookName(friendlyName) || `webhook_${index + 1}`;

      return {
        id:
          typeof row.id === "string" && row.id
            ? row.id
            : `webhook-${index}`,
        name,
        friendlyName: friendlyName || name,
        description: typeof row.description === "string" ? row.description : "",
        condition,
        method,
        url: typeof row.url === "string" ? row.url : "",
        enabled: row.enabled !== false,
        headers: readKeyValues(row.headers),
        parameters: readKeyValues(row.parameters),
        lastTestedAt:
          typeof row.lastTestedAt === "string"
            ? row.lastTestedAt
            : typeof row.last_tested_at === "string"
              ? row.last_tested_at
              : undefined,
        lastTestOk:
          typeof row.lastTestOk === "boolean"
            ? row.lastTestOk
            : typeof row.last_test_ok === "boolean"
              ? row.last_test_ok
              : undefined,
        lastTestStatus:
          typeof row.lastTestStatus === "number"
            ? row.lastTestStatus
            : typeof row.last_test_status === "number"
              ? row.last_test_status
              : undefined,
        lastTestError:
          typeof row.lastTestError === "string"
            ? row.lastTestError
            : typeof row.last_test_error === "string"
              ? row.last_test_error
              : undefined,
      };
    })
    .filter((item): item is IntegrationWebhook => item !== null);
}

export function serializeIntegrationWebhooks(webhooks: IntegrationWebhook[]): IntegrationWebhook[] {
  return webhooks.map((hook) => ({
    id: hook.id,
    name: slugifyWebhookName(hook.name) || slugifyWebhookName(hook.friendlyName) || hook.id,
    friendlyName: hook.friendlyName.trim() || hook.name.trim(),
    description: hook.description.trim(),
    condition: hook.condition,
    method: hook.method,
    url: hook.url.trim(),
    enabled: hook.enabled,
    headers: hook.headers
      .map((h) => ({ key: h.key.trim(), value: h.value }))
      .filter((h) => h.key),
    parameters: hook.parameters
      .map((p) => ({ key: p.key.trim(), value: p.value }))
      .filter((p) => p.key),
    lastTestedAt: hook.lastTestedAt,
    lastTestOk: hook.lastTestOk,
    lastTestStatus: hook.lastTestStatus,
    lastTestError: hook.lastTestError?.slice(0, 240),
  }));
}
