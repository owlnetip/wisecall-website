import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export function suppressionHours() {
  const value = Number(Deno.env.get("WISECALL_SMS_SUPPRESSION_HOURS") || 24);
  return Number.isFinite(value) && value > 0 ? value : 24;
}

/** Canonical UK mobile digits for dedupe: 447XXXXXXXXX (no +). */
export function normalizeUkMobileDigits(raw: string) {
  let digits = String(raw || "")
    .trim()
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "")
    .replace(/^00/, "");

  if (digits.startsWith("07")) {
    digits = `44${digits.slice(1)}`;
  }

  return /^447\d{9}$/.test(digits) ? digits : "";
}

export function getSupabaseServiceClient(): SupabaseClient | null {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

export type RecentSmsMatch = {
  id: string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
  caller_id?: string | null;
};

export async function findRecentSms(
  supabase: SupabaseClient | null,
  phone: string,
  options: {
    profileSlug?: string;
    /** When true, suppress repeat texts to the same mobile across all profiles. */
    ignoreProfileSlug?: boolean;
    linkType?: string;
  } = {},
): Promise<RecentSmsMatch | null> {
  if (!supabase) {
    return null;
  }

  const normalizedPhone = normalizeUkMobileDigits(phone);
  if (!normalizedPhone) {
    return null;
  }

  const since = new Date(Date.now() - suppressionHours() * 60 * 60 * 1000).toISOString();
  let query = supabase
    .from("wisecall_call_logs")
    .select("id,created_at,metadata,caller_id")
    .eq("outcome", "sms_sent")
    .filter("metadata->>record_type", "eq", "sms")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(30);

  if (!options.ignoreProfileSlug && options.profileSlug) {
    query = query.filter("metadata->>profile_slug", "eq", options.profileSlug);
  }

  if (options.linkType) {
    query = query.filter("metadata->>link_type", "eq", options.linkType);
  }

  const { data, error } = await query;

  if (error) {
    console.error("WiseCall SMS dedupe lookup failed", {
      error: error.message,
      profile_slug: options.profileSlug || null,
      link_type: options.linkType || null,
    });
    return null;
  }

  const rows = (data || []) as RecentSmsMatch[];
  return (
    rows.find((row) => normalizeUkMobileDigits(String(row.caller_id || "")) === normalizedPhone) ||
    null
  );
}

export async function logSmsAttempt(
  supabase: SupabaseClient | null,
  payload: {
    phone: string;
    profile_id?: string | null;
    profile_slug: string;
    link_type: string;
    call_id?: string | null;
    provider?: string | null;
    provider_message_id?: string | null;
    status: "sent" | "failed";
    message: string;
    portal_url?: string;
    template_version?: string;
  },
) {
  if (!supabase) {
    return;
  }

  const normalizedPhone = normalizeUkMobileDigits(payload.phone) || payload.phone;

  const { error } = await supabase.from("wisecall_call_logs").insert({
    call_id: `sms_${crypto.randomUUID()}`,
    profile_id: payload.profile_id || null,
    profile_name: payload.profile_slug,
    caller_id: normalizedPhone,
    summary:
      payload.status === "sent"
        ? `WiseCall SMS sent for ${payload.link_type || "general"}`
        : `WiseCall SMS failed for ${payload.link_type || "general"}`,
    outcome: payload.status === "sent" ? "sms_sent" : "sms_failed",
    transcript: "",
    metadata: {
      record_type: "sms",
      original_call_id: payload.call_id || null,
      profile_slug: payload.profile_slug,
      link_type: payload.link_type || "general",
      provider: payload.provider || null,
      provider_message_id: payload.provider_message_id || null,
      message_preview: payload.message.slice(0, 160),
      ...(payload.portal_url ? { portal_url: payload.portal_url } : {}),
      ...(payload.template_version ? { template_version: payload.template_version } : {}),
    },
  });

  if (error) {
    console.error("WiseCall SMS log insert failed", {
      error: error.message,
      profile_slug: payload.profile_slug,
      link_type: payload.link_type,
    });
  }
}
