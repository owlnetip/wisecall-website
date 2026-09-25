import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getSalesforceAccess } from "@/lib/salesforce-sms-client";
import { normaliseSmsDestination, readSalesforceSmsEnv, secretsMatch } from "@/lib/salesforce-sms";
import { postReplyToSalesforce, replyDigits } from "@/lib/salesforce-sms-direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SMS reply → Salesforce (BetterMove architecture, 25 Sep 2026).
// wisecall-sms-inbound forwards a reply here when the number has a stored
// Salesforce thread, or when it came in on a Salesforce-only SMS number.
// Salesforce (WiseCallSmsReplyResource) does the matching, the Task and the
// fallback email. Returning routed:false lets the AI receptionist handle it.

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return json({ ok: true, routed: false, skipped: "not_configured" });
  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Record<string, unknown>;
  try {
    const payload = await request.json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
    body = payload as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "JSON object body is required." }, 400);
  }

  const profileId = String(body.profile_id || "").trim().toLowerCase();
  const phone = normaliseSmsDestination(String(body.from || ""));
  const digits = replyDigits(String(body.from || ""));
  const text = String(body.text || "").trim();
  const messageId = typeof body.message_id === "string" && body.message_id ? body.message_id : null;
  const salesforceNumber = body.salesforce_number === true;

  if (!profileId || !phone || !digits || !text) return json({ ok: true, routed: false, skipped: "incomplete" });
  if (!read.config.profileIds.includes(profileId)) return json({ ok: true, routed: false, skipped: "profile_not_enabled" });

  const supabase = getServiceSupabase();
  if (!supabase) return json({ ok: false, routed: true, delivered: false, error: "Server not configured." }, 503);

  const { data: binding, error: bindingError } = await supabase
    .from("wisecall_salesforce_sms_bindings")
    .select("id, salesforce_record_id")
    .eq("profile_id", profileId)
    .eq("phone_digits", digits)
    .maybeSingle();
  if (bindingError) {
    console.error("[salesforce-sms] inbound binding lookup failed", bindingError.message);
    return json({ ok: false, routed: true, delivered: false, error: "Salesforce reply routing failed." }, 502);
  }
  if (!binding && !salesforceNumber) return json({ ok: true, routed: false });
  if (!messageId) return json({ ok: false, routed: true, delivered: false, error: "A provider message id is required." }, 422);

  // Reserve by provider message id so a replayed webhook never logs twice.
  const idempotencyKey = `inbound:${messageId}`;
  const { data: reservation, error: reserveError } = await supabase
    .from("wisecall_salesforce_sms_messages")
    .insert({
      profile_id: profileId, binding_id: binding?.id ?? null, direction: "inbound",
      phone_digits: digits, body: text, status: "routing",
      salesforce_record_id: binding?.salesforce_record_id ?? null, provider: "salesforce",
      provider_message_id: messageId, idempotency_key: idempotencyKey, detail: {},
    })
    .select("id")
    .single();
  if (reserveError?.code === "23505") {
    const { data: existing } = await supabase
      .from("wisecall_salesforce_sms_messages")
      .select("status, salesforce_task_id")
      .eq("profile_id", profileId).eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const delivered = existing?.status === "routed";
    return json({ ok: delivered, routed: true, delivered, idempotent_replay: true, salesforce_task_id: existing?.salesforce_task_id ?? null }, delivered ? 200 : 503);
  }
  if (reserveError || !reservation) {
    return json({ ok: false, routed: true, delivered: false, error: "Could not reserve inbound delivery." }, 502);
  }

  let outcome;
  try {
    const access = await getSalesforceAccess(read.config);
    outcome = await postReplyToSalesforce({
      access, phone, content: text, recordId: binding?.salesforce_record_id ?? null, messageId,
    });
  } catch (error) {
    outcome = {
      delivered: false, status: 0, matchType: null, recordId: null, taskId: null, fallbackEmailSent: false,
      error: error instanceof Error ? error.message.slice(0, 300) : "Salesforce unreachable",
    };
  }

  await supabase.from("wisecall_salesforce_sms_messages").update({
    status: outcome.delivered ? "routed" : "route_failed",
    salesforce_record_id: outcome.recordId ?? binding?.salesforce_record_id ?? null,
    salesforce_task_id: outcome.taskId,
    detail: {
      match_type: outcome.matchType,
      fallback_email_sent: outcome.fallbackEmailSent,
      ...(outcome.error ? { error: outcome.error } : {}),
    },
  }).eq("id", reservation.id);

  if (!outcome.delivered) {
    return json({ ok: false, routed: true, delivered: false, error: outcome.error || "Salesforce did not accept the reply." }, 502);
  }
  return json({
    ok: true, routed: true, delivered: true,
    match_type: outcome.matchType, record_id: outcome.recordId, salesforce_task_id: outcome.taskId,
  });
}
