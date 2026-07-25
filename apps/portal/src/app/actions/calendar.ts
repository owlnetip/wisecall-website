"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import {
  buildCalendarBookingWebhooks,
  isCalendarBookingWebhook,
} from "@/lib/calendar-booking-template";
import {
  readIntegrationWebhooks,
  serializeIntegrationWebhooks,
  validateIntegrationWebhooks,
  type IntegrationWebhook,
} from "@/lib/integration-webhooks";
import { webhookSupabaseUrl } from "@/lib/template-webhooks";

// Cal.com pins each v2 controller to its own version. event-types only accepts
// 2024-06-14 and 404s on anything newer, which is easy to mistake for a bad key.
const CALCOM_VERSION_EVENT_TYPES = "2024-06-14";

export type CalendarEventType = {
  id: string | number;
  slug?: string;
  title: string;
  duration_mins: number | null;
};

export type CalendarConnection = {
  id: string;
  provider: "cal_com" | "calendly" | "google" | "microsoft";
  account_email: string | null;
  status: string;
  event_types: CalendarEventType[];
  config: Record<string, unknown>;
  connected: boolean;
  /** Diary tools currently exposed to the agent on a call. */
  bookingTools: string[];
};

async function effectiveUserId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  if (isAdmin(user)) {
    const cookieStore = await cookies();
    return cookieStore.get(IMPERSONATE_COOKIE)?.value || user.id;
  }
  return user.id;
}

async function assertProfileOwned(profileId: string, userId: string): Promise<boolean> {
  const svc = getServiceSupabase();
  if (!svc) return false;
  const { data } = await svc
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return false;
  return (data.metadata as { owner_id?: string } | null)?.owner_id === userId;
}

async function calcomListEventTypes(apiKey: string): Promise<CalendarEventType[]> {
  const res = await fetch("https://api.cal.com/v2/event-types", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "cal-api-version": CALCOM_VERSION_EVENT_TYPES,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Cal.com event types failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const body = await res.json();
  const data = body?.data ?? [];
  return (Array.isArray(data) ? data : []).map(
    (e: { id: string | number; slug?: string; title?: string; lengthInMinutes?: number; length?: number }) => ({
      id: e.id,
      slug: e.slug,
      title: e.title || e.slug || String(e.id),
      duration_mins: e.lengthInMinutes ?? e.length ?? null,
    }),
  );
}

type ServiceClient = NonNullable<ReturnType<typeof getServiceSupabase>>;

async function readProfileWebhooks(
  svc: ServiceClient,
  profileId: string,
): Promise<{ metadata: Record<string, unknown>; webhooks: IntegrationWebhook[] }> {
  const { data } = await svc
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", profileId)
    .maybeSingle();
  const metadata = ((data?.metadata as Record<string, unknown> | null) ?? {}) as Record<
    string,
    unknown
  >;
  return { metadata, webhooks: readIntegrationWebhooks(metadata) };
}

/**
 * Connecting a diary is what makes booking real, so the during-call tools follow
 * the connection rather than the template: connect and the agent can book on the
 * next call, disconnect and the tools disappear instead of failing mid-sentence.
 *
 * A tool-sync problem must never fail the connect itself — the credentials are
 * saved either way and the customer can re-run this from the Technical tab.
 */
async function syncBookingTools(
  svc: ServiceClient,
  profileId: string,
  mode: "add" | "remove",
): Promise<string[]> {
  const { metadata, webhooks } = await readProfileWebhooks(svc, profileId);

  let next: IntegrationWebhook[];
  if (mode === "add") {
    const supabaseUrl = webhookSupabaseUrl();
    if (!supabaseUrl) return webhooks.filter(isCalendarBookingWebhook).map((h) => h.name);
    const taken = new Set(webhooks.map((hook) => hook.name));
    const additions = buildCalendarBookingWebhooks({
      supabaseUrl,
      smsSecret: process.env.WISECALL_SMS_WEBHOOK_SECRET,
    }).filter((hook) => !taken.has(hook.name));
    next = additions.length ? [...webhooks, ...additions] : webhooks;
  } else {
    next = webhooks.filter((hook) => !isCalendarBookingWebhook(hook));
  }

  if (next.length !== webhooks.length) {
    const validationError = validateIntegrationWebhooks(next);
    if (validationError) {
      console.error("[calendar] booking tool sync skipped:", validationError);
      return webhooks.filter(isCalendarBookingWebhook).map((hook) => hook.name);
    }
    const { error } = await svc
      .from("wisecall_profiles")
      .update({
        metadata: { ...metadata, integration_webhooks: serializeIntegrationWebhooks(next) },
      })
      .eq("id", profileId);
    if (error) {
      console.error("[calendar] booking tool sync failed:", error.message);
      return webhooks.filter(isCalendarBookingWebhook).map((hook) => hook.name);
    }
  }

  return next.filter(isCalendarBookingWebhook).map((hook) => hook.name);
}

export async function getCalendarConnection(
  profileId: string,
): Promise<{ ok: true; connection: CalendarConnection | null } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data: rows, error } = await svc
    .from("wisecall_calendar_connections")
    .select("id, provider, account_email, status, event_types, config")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(5);

  if (error) return { ok: false, error: error.message };
  const data =
    (rows || []).find((r) => r.provider === "cal_com" && r.status === "connected") ||
    (rows || [])[0];
  if (!data) return { ok: true, connection: null };

  const { webhooks } = await readProfileWebhooks(svc, profileId);

  return {
    ok: true,
    connection: {
      id: data.id as string,
      provider: data.provider as CalendarConnection["provider"],
      account_email: (data.account_email as string | null) ?? null,
      status: data.status as string,
      event_types: Array.isArray(data.event_types) ? (data.event_types as CalendarEventType[]) : [],
      config: (data.config as Record<string, unknown>) || {},
      connected: data.status === "connected",
      bookingTools: webhooks.filter(isCalendarBookingWebhook).map((hook) => hook.name),
    },
  };
}

/**
 * Checks a Cal.com key before the agent exists, so the setup wizard can give
 * immediate feedback instead of failing after the agent has been created.
 */
export async function verifyCalComApiKey(
  apiKey: string,
): Promise<{ ok: true; eventTypes: CalendarEventType[] } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };

  const key = apiKey.trim();
  if (!key || key.length < 10) return { ok: false, error: "Paste a valid Cal.com API key" };

  try {
    return { ok: true, eventTypes: await calcomListEventTypes(key) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function connectCalCom(
  profileId: string,
  apiKey: string,
): Promise<{ ok: true; connection: CalendarConnection } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const key = apiKey.trim();
  if (!key || key.length < 10) return { ok: false, error: "Paste a valid Cal.com API key" };

  let eventTypes: CalendarEventType[];
  try {
    eventTypes = await calcomListEventTypes(key);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const row = {
    profile_id: profileId,
    provider: "cal_com",
    access_token: key,
    account_email: null as string | null,
    status: "connected",
    event_types: eventTypes,
    config: { connected_via: "portal" },
    updated_at: new Date().toISOString(),
    last_error: null,
  };

  const { data: existing } = await svc
    .from("wisecall_calendar_connections")
    .select("id")
    .eq("profile_id", profileId)
    .eq("provider", "cal_com")
    .maybeSingle();

  let id: string;
  if (existing?.id) {
    const { error } = await svc
      .from("wisecall_calendar_connections")
      .update(row)
      .eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    id = existing.id as string;
  } else {
    const { data, error } = await svc
      .from("wisecall_calendar_connections")
      .insert(row)
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: error?.message || "Failed to save connection" };
    id = data.id as string;
  }

  const bookingTools = await syncBookingTools(svc, profileId, "add");

  return {
    ok: true,
    connection: {
      id,
      provider: "cal_com",
      account_email: null,
      status: "connected",
      event_types: eventTypes,
      config: row.config,
      connected: true,
      bookingTools,
    },
  };
}

export async function saveCalComEventTypes(
  profileId: string,
  eventTypes: CalendarEventType[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { error } = await svc
    .from("wisecall_calendar_connections")
    .update({
      event_types: eventTypes,
      updated_at: new Date().toISOString(),
    })
    .eq("profile_id", profileId)
    .eq("provider", "cal_com");

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function disconnectCalendar(
  profileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { error } = await svc
    .from("wisecall_calendar_connections")
    .delete()
    .eq("profile_id", profileId);

  if (error) return { ok: false, error: error.message };

  // Leaving the tools in place would have the agent confidently offering slots it
  // can no longer see.
  await syncBookingTools(svc, profileId, "remove");
  return { ok: true };
}
