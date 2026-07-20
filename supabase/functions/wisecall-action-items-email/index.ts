import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function recipients(metadata: Record<string, unknown>): string[] {
  const configured = uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
  ]);
  if (configured.length) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "WiseCall <hello@wisecall.io>";

  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase not configured" }, 500);
  if (!resendKey) return json({ ok: false, skipped: "missing_resend" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const profileId = String(body.profile_id || "");
  const callerId = String(body.caller_id || "Unknown");
  const actionItems = Array.isArray(body.action_items)
    ? body.action_items.filter((v): v is string => typeof v === "string" && v.trim()).slice(0, 8)
    : [];
  const managerSummary = typeof body.manager_summary === "string" ? body.manager_summary : "";

  if (!profileId || actionItems.length === 0) {
    return json({ ok: true, skipped: "no_action_items" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("profile_name, business_name, clinic_name, metadata")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile) return json({ ok: false, error: "Profile not found" }, 404);

  const businessName =
    profile.business_name || profile.clinic_name || profile.profile_name || "Your business";
  const to = recipients((profile.metadata as Record<string, unknown>) ?? {});
  if (!to.length) return json({ ok: true, skipped: "no_recipients" });

  const listHtml = actionItems
    .map((item) => `<li style="margin-bottom:8px;">${escapeHtml(item)}</li>`)
    .join("");

  const criticalOnly = body.critical_only === true;
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#172929;max-width:560px;">
      <h2 style="margin:0 0 12px;font-size:18px;">${criticalOnly ? "Critical action needed" : "Action items"} from ${escapeHtml(callerId)}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">${escapeHtml(businessName)} · ${criticalOnly ? "complaint or critical follow-up after a conversation." : "follow-up tasks extracted after a conversation."}</p>
      ${managerSummary ? `<p style="margin:0 0 16px;padding:12px;background:#f0faf9;border-radius:8px;"><strong>Summary:</strong> ${escapeHtml(managerSummary)}</p>` : ""}
      <ul style="padding-left:20px;margin:0;">${listHtml}</ul>
      <p style="margin:24px 0 0;font-size:12px;color:#7a8a89;">Track and mark these done in your WiseCall portal. Other open work is summarised in your morning/afternoon ops email.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `${criticalOnly ? "Critical" : "Action items"} · ${callerId} · ${businessName}`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("wisecall-action-items-email resend failed:", res.status, await res.text());
    return json({ ok: false, error: "Send failed" }, 502);
  }

  return json({ ok: true, sent: to.length });
});
