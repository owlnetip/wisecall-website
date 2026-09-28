import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { smsSegments } from "../_shared/sms-segments.ts";
import { smsStatusToken } from "../_shared/sms-status-token.ts";

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
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
  if (!stripeKey && !dryRun) return json({ error: "STRIPE_SECRET_KEY not set" }, 503);

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
    for (const log of logs ?? []) {
      const parts = Math.max(1, smsSegments(smsText(log)));
      if (dryRun) { sent += 1; segments += parts; continue; }
      const body = new URLSearchParams({
        event_name: cfg.meter_event,
        "payload[stripe_customer_id]": cfg.stripe_customer_id,
        "payload[value]": String(parts),
        identifier: `sms-${log.id}`,
        timestamp: String(Math.floor(Date.parse(log.created_at) / 1000)),
      });
      const res = await fetch("https://api.stripe.com/v1/billing/meter_events", {
        method: "POST",
        headers: { Authorization: `Bearer ${stripeKey}`, "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      const result = await res.json().catch(() => ({}));
      // A duplicate identifier means Stripe already has it: treat as reported.
      const duplicate = res.status === 400 && /identifier/i.test(String(result?.error?.message || ""));
      if (!res.ok && !duplicate) {
        failed += 1;
        console.error("[sms-metering] meter event failed", res.status, result?.error?.message);
        continue;
      }
      const { data: fresh } = await supabase.from("wisecall_call_logs").select("metadata").eq("id", log.id).maybeSingle();
      await supabase.from("wisecall_call_logs").update({
        metadata: { ...(fresh?.metadata || log.metadata || {}), stripe_metered_at: new Date().toISOString(), stripe_segments: parts },
      }).eq("id", log.id);
      sent += 1;
      segments += parts;
    }
    report.push({ profile: profile.profile_name, texts: sent, segments, failed, remaining_hint: (logs?.length ?? 0) === 200 });
  }
  return json({ ok: true, dry_run: dryRun, report });
});
