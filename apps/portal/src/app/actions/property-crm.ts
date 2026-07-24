"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import {
  getPropertyCrmProvider,
  type PropertyCrmProviderId,
} from "@/lib/property-crm-providers";
import {
  syncCrmProvider,
  validateCrmConnection,
  type CrmPropertyRecord,
} from "@/lib/property-crm-sync";

export type CrmConnectionRow = {
  id: string;
  provider: PropertyCrmProviderId;
  status: string;
  accountLabel: string | null;
  config: Record<string, unknown>;
  lastSyncAt: string | null;
  lastSyncError: string | null;
  lastSyncCount: number | null;
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
  const ownerId = (data.metadata as { owner_id?: string } | null)?.owner_id;
  return ownerId === userId;
}

function rowToConnection(data: Record<string, unknown>): CrmConnectionRow {
  return {
    id: data.id as string,
    provider: data.provider as PropertyCrmProviderId,
    status: data.status as string,
    accountLabel: (data.account_label as string | null) ?? null,
    config: (data.config as Record<string, unknown>) || {},
    lastSyncAt: (data.last_sync_at as string | null) ?? null,
    lastSyncError: (data.last_sync_error as string | null) ?? null,
    lastSyncCount: (data.last_sync_count as number | null) ?? null,
    connected: data.status === "connected",
  };
}

export async function listCrmConnections(
  profileId: string,
): Promise<{ ok: true; connections: CrmConnectionRow[] } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data, error } = await svc
    .from("wisecall_crm_connections")
    .select(
      "id, provider, status, account_label, config, last_sync_at, last_sync_error, last_sync_count",
    )
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false });

  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    connections: (data || []).map((r) => rowToConnection(r as Record<string, unknown>)),
  };
}

export async function connectPropertyCrm(input: {
  profileId: string;
  provider: PropertyCrmProviderId;
  secret: string;
  secondSecret?: string;
  config?: Record<string, string>;
}): Promise<{ ok: true; connection: CrmConnectionRow } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(input.profileId, userId))) return { ok: false, error: "Forbidden" };

  const providerDef = getPropertyCrmProvider(input.provider);
  if (!providerDef) return { ok: false, error: "Unknown CRM provider" };

  const secret = input.secret.trim();
  if (!secret) return { ok: false, error: `${providerDef.secretField.label} is required` };

  for (const field of providerDef.configFields) {
    if (field.required && !input.config?.[field.key]?.trim()) {
      return { ok: false, error: `${field.label} is required` };
    }
  }

  if (providerDef.secondSecretField && !input.secondSecret?.trim()) {
    return { ok: false, error: `${providerDef.secondSecretField.label} is required` };
  }

  const config: Record<string, unknown> = {};
  for (const field of providerDef.configFields) {
    const val = input.config?.[field.key]?.trim();
    if (val) config[field.key] = val;
  }

  try {
    const validated = await validateCrmConnection(input.provider, {
      accessToken: secret,
      refreshToken: input.secondSecret?.trim() || null,
      config,
    });

    const svc = getServiceSupabase();
    if (!svc) return { ok: false, error: "Database unavailable" };

    const now = new Date().toISOString();
    const payload = {
      profile_id: input.profileId,
      provider: input.provider,
      status: "connected",
      access_token: secret,
      refresh_token: input.secondSecret?.trim() || null,
      account_label: validated.accountLabel || providerDef.label,
      config,
      last_sync_error: null,
      updated_at: now,
    };

    const { data, error } = await svc
      .from("wisecall_crm_connections")
      .upsert(payload, { onConflict: "profile_id,provider" })
      .select(
        "id, provider, status, account_label, config, last_sync_at, last_sync_error, last_sync_count",
      )
      .single();

    if (error || !data) return { ok: false, error: error?.message || "Failed to save connection" };
    return { ok: true, connection: rowToConnection(data as Record<string, unknown>) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function disconnectPropertyCrm(
  profileId: string,
  provider: PropertyCrmProviderId,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { error } = await svc
    .from("wisecall_crm_connections")
    .delete()
    .eq("profile_id", profileId)
    .eq("provider", provider);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function upsertCrmProperties(
  profileId: string,
  provider: PropertyCrmProviderId,
  rows: CrmPropertyRecord[],
): Promise<number> {
  const svc = getServiceSupabase();
  if (!svc) throw new Error("Database unavailable");

  let count = 0;
  for (const row of rows) {
    const ownerPhone = row.ownerPhone?.trim();
    if (!row.address.trim() || !ownerPhone) continue;

    const metadata = {
      crm_provider: provider,
      crm_external_id: row.externalId,
      synced_at: new Date().toISOString(),
    };

    const payload = {
      profile_id: profileId,
      address: row.address.trim(),
      postcode: row.postcode?.trim() || null,
      listing_ref: row.listingRef?.trim() || null,
      owner_name: row.ownerName?.trim() || null,
      owner_phone: ownerPhone,
      owner_email: row.ownerEmail?.trim() || null,
      owner_preferred_channel: "sms" as const,
      is_active: true,
      metadata,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await svc
      .from("wisecall_properties")
      .select("id")
      .eq("profile_id", profileId)
      .contains("metadata", { crm_external_id: row.externalId })
      .maybeSingle();

    if (existing?.id) {
      await svc.from("wisecall_properties").update(payload).eq("id", existing.id);
    } else if (row.listingRef) {
      const { data: byRef } = await svc
        .from("wisecall_properties")
        .select("id")
        .eq("profile_id", profileId)
        .eq("listing_ref", row.listingRef)
        .maybeSingle();
      if (byRef?.id) {
        await svc.from("wisecall_properties").update(payload).eq("id", byRef.id);
      } else {
        await svc.from("wisecall_properties").insert(payload);
      }
    } else {
      await svc.from("wisecall_properties").insert(payload);
    }
    count++;
  }
  return count;
}

export async function syncPropertyCrm(
  profileId: string,
  provider: PropertyCrmProviderId,
): Promise<
  { ok: true; imported: number; total: number; accountLabel?: string } | { ok: false; error: string }
> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) return { ok: false, error: "Forbidden" };

  const providerDef = getPropertyCrmProvider(provider);
  if (!providerDef?.syncSupported) {
    return { ok: false, error: "This CRM does not support sync yet" };
  }

  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data: conn, error: connErr } = await svc
    .from("wisecall_crm_connections")
    .select("*")
    .eq("profile_id", profileId)
    .eq("provider", provider)
    .eq("status", "connected")
    .maybeSingle();

  if (connErr || !conn) return { ok: false, error: "CRM not connected" };

  try {
    const result = await syncCrmProvider(provider, {
      accessToken: conn.access_token as string,
      refreshToken: (conn.refresh_token as string | null) ?? null,
      config: (conn.config as Record<string, unknown>) || {},
    });

    const imported = await upsertCrmProperties(profileId, provider, result.properties);
    const now = new Date().toISOString();

    await svc
      .from("wisecall_crm_connections")
      .update({
        last_sync_at: now,
        last_sync_count: imported,
        last_sync_error: null,
        account_label: result.accountLabel || conn.account_label,
        updated_at: now,
      })
      .eq("id", conn.id);

    return {
      ok: true,
      imported,
      total: result.properties.length,
      accountLabel: result.accountLabel,
    };
  } catch (e) {
    const message = (e as Error).message;
    await svc
      .from("wisecall_crm_connections")
      .update({
        last_sync_error: message,
        status: "error",
        updated_at: new Date().toISOString(),
      })
      .eq("id", conn.id);
    return { ok: false, error: message };
  }
}
