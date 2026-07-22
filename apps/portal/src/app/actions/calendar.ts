"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";

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
      "cal-api-version": "2024-08-13",
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
    },
  };
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
  return { ok: true };
}
