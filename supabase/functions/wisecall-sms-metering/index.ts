import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { smsSegments } from "../_shared/sms-segments.ts";
import { smsStatusToken } from "../_shared/sms-status-token.ts";
import { salesforceCallbackHeaders } from "../_shared/salesforce-sms-callback.ts";

// Reports sent SMS to a Stripe usage meter, per SMS segment, for agents with
// metadata.sms_billing = { enabled: true, stripe_customer_id, meter_event, since }.
// Counts Salesforce/agent texts (agent_sms, sms_sent) and AI SMS replies
// ("SMS replied"). Each text is reported once: Stripe dedupes on the
// identifier sms-<log id>, and the log is stamped stripe_metered_at.
// Scheduled by pg_cron; POST ?token=… (same derived token as wisecall-sms-status).
// ?dry_run=1 totals what would be sent without sending.

type Billing = { enabled?: boolean; stripe_customer_id?: string; meter_event?: string; since?: string };

function tokenMatches(supplied: string, expected: string): boolean {
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function smsText(log: Record<string, any>): string {
  const meta = log.metadata || {};
  if (meta.record_type === "agent_sms") return String(meta.request?.message || "");
  const transcript = String(log.transcript || "");
  const marker = "--- WiseCall reply ---";
  const at = transcript.indexOf(marker);
  return at >= 0 ? transcript.slice(at + marker.length).trim() : "";
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: true, service: "wisecall-sms-metering" });
  const url = new URL(req.url);
  if (!tokenMatches(url.searchParams.get("token") || "", await smsStatusToken())) return json({ error: "Unauthorized" }, 401);
  const dryRun = url.searchParams.get("dry_run") === "1";
  // Events go through the portal, whose Stripe key is on the account that owns the meters
  // (the functions' STRIPE_SECRET_KEY is on a different account).
  const portal = (Deno.env.get("WISECALL_PORTAL_URL") || "").replace(/\/+$/, "");
  const sharedSecret = Deno.env.get("WISECALL_SALESFORCE_SMS_SECRET") || "";
  if ((!portal || !sharedSecret) && !dryRun) return json({ error: "portal not configured" }, 503);

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: profiles, error } = await supabase
    .from("wisecall_profiles").select("id, profile_name, metadata")
    .eq("metadata->sms_billing->>enabled", "true");
  if (error) return json({ error: error.message }, 500);

  const report: Record<string, unknown>[] = [];
  const oldest = Date.now() - 34 * 24 * 3600_000; // Stripe accepts up to 35 days back

  for (const profile of profiles ?? []) {
    const cfg = (profile.metadata?.sms_billing ?? {}) as Billing;
    if (!cfg.stripe_customer_id || !cfg.meter_event) continue;
    const since = new Date(Math.max(Date.parse(cfg.since || "") || 0, oldest)).toISOString();

    const { data: logs, error: logError } = await supabase
      .from("wisecall_call_logs")
      .select("id, created_at, outcome, transcript, metadata")
      .eq("profile_id", profile.id)
      .gte("created_at", since)
      .is("metadata->>stripe_metered_at", null)
      .or("and(outcome.eq.sms_sent,metadata->>record_type.eq.agent_sms),outcome.eq.SMS replied")
      .order("created_at", { ascending: true })
      .limit(dryRun ? 5000 : 200);
    if (logError) {
      report.push({ profile: profile.profile_name, error: logError.message });
      continue;
    }

    let sent = 0, segments = 0, failed = 0;
    let lastError: string | null = null;
    const batch = (logs ?? []).map((log) => ({ log, parts: Math.max(1, smsSegments(smsText(log))) }));
    if (dryRun) {
      report.push({ profile: profile.profile_name, texts: batch.length, segments: batch.reduce((n, b) => n + b.parts, 0), dry_run: true });
      continue;
    }
    if (batch.length) {
      const res = await fetch(`${portal}/api/billing/meter-events`, {
        method: "POST",
        headers: salesforceCallbackHeaders(sharedSecret),
        body: JSON.stringify({
          events: batch.map(({ log, parts }) => ({
            event_name: cfg.meter_event,
            stripe_customer_id: cfg.stripe_customer_id,
            value: parts,
            identifier: `sms-${log.id}`,
            timestamp: Math.floor(Date.parse(log.created_at) / 1000),
          })),
        }),
        signal: AbortSignal.timeout(110000),
      });
      const out = await res.json().catch(() => null) as { results?: { identifier: string; ok: boolean; error?: string }[] } | null;
      const byId = new Map((out?.results ?? []).map((r) => [r.identifier, r]));
      if (!res.ok) lastError = `portal ${res.status}`;
      for (const { log, parts } of batch) {
        const r = byId.get(`sms-${log.id}`);
        if (!r?.ok) {
          failed += 1;
          if (r?.error) lastError = r.error;
          continue;
        }
        const { data: fresh } = await supabase.from("wisecall_call_logs").select("metadata").eq("id", log.id).maybeSingle();
        await supabase.from("wisecall_call_logs").update({
          metadata: { ...(fresh?.metadata || log.metadata || {}), stripe_metered_at: new Date().toISOString(), stripe_segments: parts },
        }).eq("id", log.id);
        sent += 1;
        segments += parts;
      }
    }
    report.push({ profile: profile.profile_name, texts: sent, segments, failed, last_error: lastError, remaining_hint: (logs?.length ?? 0) === 200 });
  }
  return json({ ok: true, dry_run: dryRun, report });
});
