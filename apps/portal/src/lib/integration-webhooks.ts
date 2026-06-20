// Per-agent custom integration webhooks — before, during and after a call.
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
};

export const webhookConditions: {
  value: WebhookCondition;
  label: string;
  blurb: string;
}[] = [
  {
    value: "before_call",
    label: "Before call",
    blurb: "Runs when a call connects, before the agent speaks — pre-fetch caller or CRM data.",
  },
  {
    value: "during_call",
    label: "During call",
    blurb: "Exposed as a tool the agent can call mid-conversation (bookings, tickets, lookups).",
  },
  {
    value: "after_call",
    label: "After call",
    blurb: "Fires when the call ends — log to CRM, send summaries, trigger workflows.",
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
  const friendlyName = partial?.friendlyName?.trim() || "New webhook";
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
  };
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
    .map((item, index) => {
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
      } satisfies IntegrationWebhook;
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
  }));
}
