"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import {
  isPbxType,
  isTransport,
  type SipEndpoint,
  type SipEndpointResult,
  type SipMutationResult,
  type SipRegistrationStatus,
} from "@/lib/pbx";
import { getServiceSupabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type ProfileAccessRow = {
  id: string;
  metadata: Record<string, unknown> | null;
};

type EndpointRow = {
  pbx_type: string | null;
  transport: string | null;
  sip_domain: string | null;
  sip_proxy: string | null;
  sip_username: string | null;
  sip_password: string | null;
  is_enabled: boolean | null;
};

type StatusRow = {
  registration_state: string | null;
  last_error: string | null;
  last_success_at: string | null;
  expires_at: string | null;
  sip_contact: string | null;
};

async function readUser() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  return user;
}

async function getAccessibleProfile(
  agentId: string,
): Promise<{ ok: true; row: ProfileAccessRow } | { ok: false; error: string }> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", agentId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Agent not found." };

  const row = data as ProfileAccessRow;
  if (row.metadata?.owner_id !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  return { ok: true, row };
}

function mapStatus(row: StatusRow | null): SipRegistrationStatus | null {
  if (!row) return null;
  return {
    state: (row.registration_state || "unknown") as SipRegistrationStatus["state"],
    lastError: row.last_error,
    lastSuccessAt: row.last_success_at,
    expiresAt: row.expires_at,
    contact: row.sip_contact,
  };
}

export async function getSipEndpoint(agentId: string): Promise<SipEndpointResult> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, endpoint: null, status: null, error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, endpoint: null, status: null, error: "Server not configured." };

  const [endpointRes, statusRes] = await Promise.all([
    service
      .from("wisecall_sip_endpoints")
      .select("pbx_type, transport, sip_domain, sip_proxy, sip_username, sip_password, is_enabled")
      .eq("profile_id", agentId)
      .maybeSingle(),
    service
      .from("wisecall_sip_registration_status")
      .select("registration_state, last_error, last_success_at, expires_at, sip_contact")
      .eq("profile_id", agentId)
      .maybeSingle(),
  ]);

  if (endpointRes.error) {
    return { ok: false, endpoint: null, status: null, error: endpointRes.error.message };
  }

  const row = endpointRes.data as EndpointRow | null;
  const endpoint: SipEndpoint | null = row
    ? {
        pbxType: isPbxType(row.pbx_type || "") ? (row.pbx_type as SipEndpoint["pbxType"]) : "generic",
        transport: isTransport(row.transport || "")
          ? (row.transport as SipEndpoint["transport"])
          : "udp",
        sipDomain: row.sip_domain || "",
        sipProxy: row.sip_proxy || "",
        sipUsername: row.sip_username || "",
        hasPassword: Boolean(row.sip_password),
        isEnabled: row.is_enabled ?? true,
      }
    : null;

  return {
    ok: true,
    endpoint,
    status: mapStatus((statusRes.data as StatusRow | null) ?? null),
  };
}

// Lightweight status read for polling the registration state from the card.
export async function getSipRegistrationStatus(
  agentId: string,
): Promise<{ ok: boolean; status: SipRegistrationStatus | null; error?: string }> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, status: null, error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, status: null, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_sip_registration_status")
    .select("registration_state, last_error, last_success_at, expires_at, sip_contact")
    .eq("profile_id", agentId)
    .maybeSingle();

  if (error) return { ok: false, status: null, error: error.message };
  return { ok: true, status: mapStatus((data as StatusRow | null) ?? null) };
}

export async function saveSipEndpoint(input: {
  agentId: string;
  pbxType: string;
  transport: string;
  sipDomain: string;
  sipProxy?: string;
  sipUsername: string;
  sipPassword?: string;
  isEnabled: boolean;
}): Promise<SipMutationResult> {
  const access = await getAccessibleProfile(input.agentId);
  if (!access.ok) return { ok: false, error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  if (!isPbxType(input.pbxType)) return { ok: false, error: "Unknown PBX type." };
  if (!isTransport(input.transport)) return { ok: false, error: "Unknown transport." };

  const sipDomain = input.sipDomain.trim();
  const sipUsername = input.sipUsername.trim();
  if (!sipDomain) return { ok: false, error: "PBX address (SIP domain) is required." };
  if (!sipUsername) return { ok: false, error: "Extension / SIP username is required." };

  // Determine create vs update so we can keep the stored password when the user
  // leaves the password field blank on an edit.
  const { data: existing, error: existingErr } = await service
    .from("wisecall_sip_endpoints")
    .select("id, sip_password")
    .eq("profile_id", input.agentId)
    .maybeSingle();

  if (existingErr) return { ok: false, error: existingErr.message };

  const password = (input.sipPassword || "").trim();
  if (!existing && !password) {
    return { ok: false, error: "SIP password is required." };
  }

  const row: Record<string, unknown> = {
    profile_id: input.agentId,
    pbx_type: input.pbxType,
    transport: input.transport,
    sip_domain: sipDomain,
    sip_proxy: (input.sipProxy || "").trim() || sipDomain,
    sip_username: sipUsername,
    is_enabled: input.isEnabled,
    updated_at: new Date().toISOString(),
  };

  // Don't use upsert: PostgREST defaults omitted columns to NULL, so a blank
  // password on an edit would try to write sip_password = NULL and trip the
  // NOT NULL constraint. Branch explicitly — update never touches columns we
  // didn't set, so leaving the password blank keeps the stored one.
  if (existing) {
    if (password) {
      row.sip_password = password;
    }
    const { error } = await service
      .from("wisecall_sip_endpoints")
      .update(row)
      .eq("profile_id", input.agentId);

    if (error) return { ok: false, error: error.message };
  } else {
    row.sip_password = password;
    const { error } = await service.from("wisecall_sip_endpoints").insert(row);

    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteSipEndpoint(agentId: string): Promise<SipMutationResult> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return { ok: false, error: access.error };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { error } = await service
    .from("wisecall_sip_endpoints")
    .delete()
    .eq("profile_id", agentId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
