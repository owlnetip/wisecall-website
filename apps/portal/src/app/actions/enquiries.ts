"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { cookies } from "next/headers";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import {
  buildDigestCounts,
  type EnquiryRow,
  type EnquiryStatus,
  type NegotiatorDigest,
  weekendDigestWindow,
} from "@/lib/digital-negotiator";

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

const ENQUIRY_SELECT =
  "id, profile_id, contact_id, property_id, viewing_id, call_log_id, party_role, status, contact_name, contact_phone, contact_email, budget_min, budget_max, budget_text, areas, beds_min, property_types, move_timeline, financing, has_property_to_sell, chain_position, listing_interest, listing_ref, summary, needs_human, human_reason, source, created_at, updated_at";

function mapEnquiry(row: Record<string, unknown>): EnquiryRow {
  return {
    id: String(row.id),
    profile_id: String(row.profile_id),
    contact_id: (row.contact_id as string) || null,
    property_id: (row.property_id as string) || null,
    viewing_id: (row.viewing_id as string) || null,
    call_log_id: (row.call_log_id as string) || null,
    party_role: row.party_role as EnquiryRow["party_role"],
    status: row.status as EnquiryRow["status"],
    contact_name: (row.contact_name as string) || null,
    contact_phone: (row.contact_phone as string) || null,
    contact_email: (row.contact_email as string) || null,
    budget_min: typeof row.budget_min === "number" ? row.budget_min : null,
    budget_max: typeof row.budget_max === "number" ? row.budget_max : null,
    budget_text: (row.budget_text as string) || null,
    areas: Array.isArray(row.areas) ? (row.areas as string[]) : [],
    beds_min: typeof row.beds_min === "number" ? row.beds_min : null,
    property_types: Array.isArray(row.property_types) ? (row.property_types as string[]) : [],
    move_timeline: (row.move_timeline as string) || null,
    financing: (row.financing as string) || null,
    has_property_to_sell:
      typeof row.has_property_to_sell === "boolean" ? row.has_property_to_sell : null,
    chain_position: (row.chain_position as string) || null,
    listing_interest: (row.listing_interest as string) || null,
    listing_ref: (row.listing_ref as string) || null,
    summary: (row.summary as string) || null,
    needs_human: row.needs_human === true,
    human_reason: (row.human_reason as string) || null,
    source: row.source as EnquiryRow["source"],
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listEnquiriesForProfile(
  profileId: string,
): Promise<{ ok: true; enquiries: EnquiryRow[] } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data, error } = await svc
    .from("wisecall_enquiries")
    .select(ENQUIRY_SELECT)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };
  return { ok: true, enquiries: (data || []).map((r) => mapEnquiry(r as Record<string, unknown>)) };
}

export async function updateEnquiryStatus(input: {
  profileId: string;
  enquiryId: string;
  status: EnquiryStatus;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(input.profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { error } = await svc
    .from("wisecall_enquiries")
    .update({ status: input.status, updated_at: new Date().toISOString() })
    .eq("id", input.enquiryId)
    .eq("profile_id", input.profileId);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getNegotiatorDigest(
  profileId: string,
): Promise<{ ok: true; digest: NegotiatorDigest } | { ok: false; error: string }> {
  const userId = await effectiveUserId();
  if (!userId) return { ok: false, error: "Not signed in" };
  if (!(await assertProfileOwned(profileId, userId))) {
    return { ok: false, error: "Forbidden" };
  }
  const svc = getServiceSupabase();
  if (!svc) return { ok: false, error: "Database unavailable" };

  const { data: profile } = await svc
    .from("wisecall_profiles")
    .select("timezone")
    .eq("id", profileId)
    .maybeSingle();
  const tz =
    typeof profile?.timezone === "string" && profile.timezone
      ? profile.timezone
      : "Europe/London";

  const { from, to, label } = weekendDigestWindow(new Date(), tz);

  const [{ data: viewings }, { data: enquiries, error }] = await Promise.all([
    svc
      .from("wisecall_viewing_requests")
      .select("status, created_at")
      .eq("profile_id", profileId)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .limit(200),
    svc
      .from("wisecall_enquiries")
      .select(ENQUIRY_SELECT)
      .eq("profile_id", profileId)
      .gte("created_at", from.toISOString())
      .lte("created_at", to.toISOString())
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (error) return { ok: false, error: error.message };

  const digest = buildDigestCounts({
    viewings: (viewings || []) as { status: string; created_at: string }[],
    enquiries: (enquiries || []).map((r) => mapEnquiry(r as Record<string, unknown>)),
    from,
    to,
    label,
  });

  return { ok: true, digest };
}
