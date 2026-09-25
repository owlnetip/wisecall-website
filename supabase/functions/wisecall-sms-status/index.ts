import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { salesforceCallbackHeaders } from "../_shared/salesforce-sms-callback.ts";
import { smsStatusToken } from "../_shared/sms-status-token.ts";

// Vonage Messages API delivery-status webhook for agent (Salesforce) SMS.
// Set per message by wisecall-send-sms (webhook_url + ?token=HMAC, see sms-status-token.ts).
// Records the outcome in WiseCall and, for Salesforce sends, forwards it to the
// portal, which updates the SMS Task in Salesforce. Always answers 200 so
// Vonage doesn't retry a status we have already handled or chosen to ignore.

const FINAL = new Set(["delivered", "rejected", "undeliverable", "failed", "expired"]);

function ok(body: Record<string, unknown> = { ok: true }) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function tokenMatches(supplied: string, expected: string): boolean {
  if (!supplied || !expected || supplied.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "GET") return ok({ ok: true, service: "wisecall-sms-status" });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const url = new URL(req.url);
  if (!tokenMatches(url.searchParams.get("token") || "", await smsStatusToken())) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: Record<string, unknown>;
  try {
    event = await req.json();
  } catch {
    return ok({ ok: false, skipped: "invalid_json" });
  }
  const messageId = typeof event.message_uuid === "string" ? event.message_uuid : "";
  const status = String(event.status || "").toLowerCase();
  if (!messageId || !FINAL.has(status)) return ok({ ok: true, skipped: status || "no_status" });

  const errorObj = (event.error && typeof event.error === "object") ? event.error as Record<string, unknown> : null;
  const delivery = {
    status,
    at: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
    error: errorObj ? String(errorObj.title || errorObj.detail || errorObj.type || "").slice(0, 200) || null : null,
  };

  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  // Agent SMS call log (id = client_ref = request_id).
  const clientRef = typeof event.client_ref === "string" ? event.client_ref : "";
  if (/^[0-9a-f-]{36}$/i.test(clientRef)) {
    const { data: log } = await supabase.from("wisecall_call_logs").select("metadata").eq("id", clientRef).maybeSingle();
    if (log) {
      await supabase.from("wisecall_call_logs")
        .update({ metadata: { ...(log.metadata || {}), delivery } })
        .eq("id", clientRef);
    }
  }

  // Salesforce ledger row for this message.
  const { data: row } = await supabase.from("wisecall_salesforce_sms_messages")
    .select("id, profile_id, salesforce_record_id, detail")
    .eq("provider_message_id", messageId).eq("direction", "outbound").maybeSingle();
  if (!row) return ok({ ok: true, skipped: "not_salesforce" });

  const detail = (row.detail && typeof row.detail === "object") ? row.detail as Record<string, unknown> : {};
  const previous = detail.delivery as { status?: string; forwarded?: boolean } | undefined;
  if (previous?.status === status && previous.forwarded) return ok({ ok: true, skipped: "already_forwarded" });

  let forwarded = false;
  try {
    const portal = (Deno.env.get("WISECALL_PORTAL_URL") || "").replace(/\/+$/, "");
    const res = await fetch(`${portal}/api/integrations/salesforce/sms/status`, {
      method: "POST",
      headers: salesforceCallbackHeaders(Deno.env.get("WISECALL_SALESFORCE_SMS_SECRET") || ""),
      body: JSON.stringify({
        profile_id: row.profile_id, record_id: row.salesforce_record_id, message_id: messageId, ...delivery,
      }),
      redirect: "error",
      signal: AbortSignal.timeout(20000),
    });
    const result = await res.json().catch(() => null) as Record<string, unknown> | null;
    forwarded = res.ok && result?.ok === true;
  } catch {
    forwarded = false;
  }

  await supabase.from("wisecall_salesforce_sms_messages")
    .update({ detail: { ...detail, delivery: { ...delivery, forwarded } } })
    .eq("id", row.id);
  return ok({ ok: true, forwarded });
});
