"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import type { PropertyRow, ViewingRequestRow } from "@/lib/viewing-bookings";

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

export async function listPropertiesForProfile(
  profileId: string,
): Promise<{ ok: true; properties: PropertyRow[] } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data, error } = await svc
    .from("wisecall_properties")
    .select(
      "id, profile_id, address, postcode, listing_ref, listing_url, owner_name, owner_phone, owner_email, owner_preferred_channel, is_active, created_at",
    )
    .eq("profile_id", profileId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };
  return { ok: true, properties: (data || []) as PropertyRow[] };
}

export async function listViewingsForProfile(
  profileId: string,
): Promise<{ ok: true; viewings: ViewingRequestRow[] } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data, error } = await svc
    .from("wisecall_viewing_requests")
    .select(
      "id, profile_id, property_id, property_address, listing_ref, owner_name, owner_phone, viewer_name, viewer_phone, proposed_starts_at, proposed_ends_at, status, owner_channel, agent_available, agent_availability_note, day_before_still_ok_sent_at, day_of_reminder_sent_at, source, created_at",
    )
    .eq("profile_id", profileId)
    .order("proposed_starts_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };
  return { ok: true, viewings: (data || []) as ViewingRequestRow[] };
}

export async function upsertProperty(input: {
  profileId: string;
  address: string;
  postcode?: string;
  listingRef?: string;
  ownerName?: string;
  ownerPhone: string;
  ownerEmail?: string;
  preferredChannel?: "auto" | "whatsapp" | "sms";
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(input.profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const address = input.address.trim();
  const ownerPhone = input.ownerPhone.trim();
  if (!address || !ownerPhone) return { ok: false, error: "Address and owner phone are required" };

  const { data, error } = await svc
    .from("wisecall_properties")
    .insert({
      profile_id: input.profileId,
      address,
      postcode: input.postcode?.trim() || null,
      listing_ref: input.listingRef?.trim() || null,
      owner_name: input.ownerName?.trim() || null,
      owner_phone: ownerPhone.startsWith("+") ? ownerPhone : `+${ownerPhone.replace(/\D/g, "")}`,
      owner_email: input.ownerEmail?.trim() || null,
      owner_preferred_channel: input.preferredChannel || "auto",
    })
    .select("id")
    .single();

  if (error || !data) return { ok: false, error: error?.message || "Failed to save property" };
  return { ok: true, id: data.id as string };
}

export async function requestViewing(input: {
  profileId: string;
  propertyId: string;
  startsAt: string;
  viewerName?: string;
  viewerPhone?: string;
  viewerEmail?: string;
  notes?: string;
}): Promise<{ ok: true; viewingId: string; status: string; note?: string } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(input.profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const smsSecret = process.env.WISECALL_SMS_WEBHOOK_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl) return { ok: false, error: "SUPABASE_URL not configured" };

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (smsSecret) headers["X-WiseCall-SMS-Secret"] = smsSecret;
  else if (serviceKey) {
    headers.Authorization = `Bearer ${serviceKey}`;
    headers.apikey = serviceKey;
  } else {
    return { ok: false, error: "Messaging secret not configured" };
  }

  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/wisecall-viewing-request`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      profile_id: input.profileId,
      property_id: input.propertyId,
      starts_at: input.startsAt,
      viewer_name: input.viewerName,
      viewer_phone: input.viewerPhone,
      viewer_email: input.viewerEmail,
      notes: input.notes,
      source: "manual",
    }),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    return { ok: false, error: body.error || `Request failed (${res.status})` };
  }
  return {
    ok: true,
    viewingId: body.viewing_request_id as string,
    status: body.status as string,
    note: body.note as string | undefined,
  };
}
