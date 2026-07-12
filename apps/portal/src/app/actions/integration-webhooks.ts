"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import {
  hasSameWebhookExecutionConfig,
  readIntegrationWebhooks,
  serializeIntegrationWebhooks,
  substituteWebhookTemplates,
  validateIntegrationWebhooks,
  type IntegrationWebhook,
} from "@/lib/integration-webhooks";
import {
  fetchPublicHttpUrl,
  PublicUrlError,
  readResponseText,
} from "@/lib/public-url";
import { getServiceSupabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export type IntegrationWebhookTestResult = {
  ok: boolean;
  testedAt?: string;
  httpStatus?: number;
  error?: string;
};

const TEST_TIMEOUT_MS = 8_000;
const TEST_RESPONSE_LIMIT = 64_000;

function testFailureMessage(error: unknown): string {
  if (error instanceof PublicUrlError) {
    return error.message
      .replace(/website address(?:es)?/gi, "integration endpoint")
      .replace(/webpage/gi, "endpoint");
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "The endpoint did not respond within 8 seconds.";
  }
  if (error instanceof Error && /timed?\s*out|abort/i.test(error.message)) {
    return "The endpoint did not respond within 8 seconds.";
  }
  return "WiseCall could not reach the endpoint.";
}

function buildTestRequest(hook: IntegrationWebhook, profileId: string): {
  url: string;
  init: RequestInit;
} {
  const templateContext = {
    caller_id: "+441234567890",
    profile_id: profileId,
    call_id: `test-${crypto.randomUUID()}`,
    transcript: "WiseCall integration test",
    summary: "WiseCall integration test",
  };
  const payload: Record<string, string | boolean> = {
    profileId,
    callId: templateContext.call_id,
    callerId: templateContext.caller_id,
    transcript: templateContext.transcript,
    summary: templateContext.summary,
    wisecallTest: true,
  };
  for (const parameter of hook.parameters) {
    const key = parameter.key.trim();
    if (!key) continue;
    payload[key] = parameter.value.trim()
      ? substituteWebhookTemplates(parameter.value, templateContext)
      : "Test value";
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-WiseCall-Test": "true",
  };
  for (const header of hook.headers) {
    if (header.key.trim()) headers[header.key.trim()] = header.value;
  }
  headers["X-WiseCall-Test"] = "true";

  const method = hook.method;
  if (method === "GET") {
    const url = new URL(substituteWebhookTemplates(hook.url, templateContext));
    for (const [key, value] of Object.entries(payload)) {
      if (key !== "profileId" && key !== "callId") url.searchParams.set(key, String(value));
    }
    return { url: url.toString(), init: { method, headers } };
  }

  return {
    url: substituteWebhookTemplates(hook.url, templateContext),
    init: { method, headers, body: JSON.stringify(payload) },
  };
}

export async function testIntegrationWebhook(
  agentId: string,
  webhookId: string,
): Promise<IntegrationWebhookTestResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Sign in again to test this integration." };
  const admin = isAdmin(user);
  if (!admin && !hasActiveAccess(await getBillingForUser(user.id))) {
    return { ok: false, error: "Start your free trial before testing integrations." };
  }

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const { data, error: readError } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", agentId)
    .maybeSingle();
  if (readError) return { ok: false, error: readError.message };
  if (!data) return { ok: false, error: "Agent not found." };

  const metadata = (data.metadata as Record<string, unknown> | null) ?? {};
  if (metadata.owner_id !== user.id && !admin) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  const webhooks = readIntegrationWebhooks(metadata);
  const hook = webhooks.find((item) => item.id === webhookId);
  if (!hook) return { ok: false, error: "Save this integration before testing it." };
  if (!hook.enabled) return { ok: false, error: "Enable and save this integration before testing it." };
  if (hook.method === "DELETE") {
    return { ok: false, error: "DELETE integrations are not test-fired to prevent accidental data removal." };
  }
  const validationError = validateIntegrationWebhooks([hook]);
  if (validationError) return { ok: false, error: validationError };

  const testedAt = new Date().toISOString();
  let httpStatus: number | undefined;
  let testError: string | undefined;
  try {
    const request = buildTestRequest(hook, agentId);
    const response = await fetchPublicHttpUrl(request.url, {
      ...request.init,
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
    httpStatus = response.status;
    await readResponseText(response, TEST_RESPONSE_LIMIT);
    if (!response.ok) testError = `The endpoint returned HTTP ${response.status}.`;
  } catch (error) {
    testError = testFailureMessage(error);
  }

  const { data: latestData, error: latestReadError } = await service
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", agentId)
    .maybeSingle();
  if (latestReadError || !latestData) {
    return { ok: false, error: "The test ran, but its result could not be saved." };
  }
  const latestMetadata = (latestData.metadata as Record<string, unknown> | null) ?? {};
  const latestWebhooks = readIntegrationWebhooks(latestMetadata);
  const latestHook = latestWebhooks.find((item) => item.id === webhookId);
  if (!latestHook || !hasSameWebhookExecutionConfig(hook, latestHook)) {
    return { ok: false, error: "This integration changed while the test was running. Save it and test again." };
  }

  const updatedWebhooks = latestWebhooks.map((item) =>
    item.id === webhookId
      ? {
          ...item,
          lastTestedAt: testedAt,
          lastTestOk: !testError,
          lastTestStatus: httpStatus,
          lastTestError: testError,
        }
      : item,
  );
  const nextMetadata = {
    ...latestMetadata,
    integration_webhooks: serializeIntegrationWebhooks(updatedWebhooks),
  };
  let updateQuery = service
    .from("wisecall_profiles")
    .update({ metadata: nextMetadata })
    .eq("id", agentId);
  if (!admin) updateQuery = updateQuery.eq("metadata->>owner_id", user.id);
  const { error: updateError } = await updateQuery;
  if (updateError) {
    return { ok: false, error: "The test ran, but its result could not be saved." };
  }

  revalidatePath("/dashboard");
  return testError
    ? { ok: false, testedAt, httpStatus, error: testError }
    : { ok: true, testedAt, httpStatus };
}
