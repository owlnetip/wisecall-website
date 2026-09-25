import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createSalesforceSmsTask, getSalesforceAccess, sendSalesforceReplyNotification } from "@/lib/salesforce-sms-client";
import {
  canonicalSmsDigits,
  normaliseSmsDestination,
  planInboundSalesforceReply,
  readSalesforceSmsEnv,
  secretsMatch,
  type SalesforceSmsRecord,
} from "@/lib/salesforce-sms";
import { loadSmsBinding } from "@/lib/salesforce-sms-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Inbound Vonage replies for numbers that already have a confirmed Salesforce
// mapping. The recipient is the confirmed owner or user. Numbers with no
// confirmed mapping return routed:false so the existing SMS receptionist continues.

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return json({ ok: true, routed: false, skipped: "not_configured" });

  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  if (!payload || typeof payload !== "object") {
    return json({ ok: false, error: "JSON object body is required." }, 400);
  }
  const body = payload as Record<string, unknown>;
  const profileId = String(body.profile_id || "").trim().toLowerCase();
  const from = String(body.from || "");
  const text = String(body.text || "").trim();
  const messageId = typeof body.message_id === "string" ? body.message_id : null;
  const phone = normaliseSmsDestination(from);
  const digits = canonicalSmsDigits(from);

  if (!profileId || !phone || !digits || !text) {
    return json({ ok: true, routed: false, skipped: "incomplete" });
  }
  if (!read.config.profileIds.includes(profileId)) {
    return json({ ok: true, routed: false, skipped: "profile_not_enabled" });
  }

  const supabase = getServiceSupabase();
  if (!supabase) return json({ ok: false, routed: false, error: "Server not configured." }, 503);

  let binding;
  try {
    binding = await loadSmsBinding(supabase, profileId, digits);
  } catch (error) {
    console.error("[salesforce-sms] inbound binding lookup failed", error instanceof Error ? error.message : error);
    return json({ ok: false, routed: false, error: "Salesforce reply routing failed." }, 502);
  }

  const plan = planInboundSalesforceReply(binding);
  if (plan.status === "passthrough") {
    return json({ ok: true, routed: false });
  }

  const record: SalesforceSmsRecord = {
    id: plan.binding.salesforceRecordId,
    objectType: plan.binding.salesforceObject,
    name: plan.binding.recordName || plan.binding.salesforceObject,
    phones: [phone],
    ownerId: plan.binding.replyRoute.type === "owner" ? plan.binding.replyRoute.recipientId : null,
    ownerName: plan.binding.replyRoute.recipientName,
    ownerEmail: plan.binding.replyRoute.recipientEmail,
  };

  try {
    if (!messageId) return json({ ok: false, routed: true, delivered: false, error: "A provider message id is required." }, 422);
    // Reserve before creating a Task: concurrent/replayed callbacks cannot
    // create duplicate Salesforce activities. Uncertain attempts need review.
    const idempotencyKey = `inbound:${messageId}`;
    const { data: reservation, error: reserveError } = await supabase.from("wisecall_salesforce_sms_messages").insert({
      profile_id: profileId, binding_id: plan.binding.id ?? null,
      direction: "inbound", phone_digits: digits, body: text, status: "routing",
      salesforce_record_id: record.id, provider: "salesforce",
      provider_message_id: messageId, idempotency_key: idempotencyKey,
      detail: { reply_recipient_id: plan.binding.replyRoute.recipientId },
    }).select("id").single();
    if (reserveError?.code === "23505") {
      const { data: existing, error } = await supabase.from("wisecall_salesforce_sms_messages")
        .select("body, phone_digits, status, salesforce_task_id")
        .eq("profile_id", profileId).eq("idempotency_key", idempotencyKey).single();
      if (error) throw new Error("Could not read inbound delivery reservation");
      if (existing.body !== text || existing.phone_digits !== digits) {
        return json({ ok: false, routed: true, delivered: false, error: "Message id conflicts with a different reply." }, 409);
      }
      const delivered = existing.status === "routed" && !!existing.salesforce_task_id;
      return json({ ok: delivered, routed: true, delivered, idempotent_replay: true,
        salesforce_task_id: existing.salesforce_task_id,
        ...(!delivered ? { error: "Reply delivery is pending or needs review; it was not retried." } : {}),
      }, delivered ? 200 : 503);
    }
    if (reserveError || !reservation) throw new Error("Could not reserve inbound delivery");
    const access = await getSalesforceAccess(read.config);
    const task = await createSalesforceSmsTask({
      access,
      record,
      replyRoute: plan.binding.replyRoute,
      phone,
      text,
      direction: "inbound",
    });

    const notification = task.taskId
      ? await sendSalesforceReplyNotification({
          access,
          recipientId: plan.binding.replyRoute.recipientId,
          targetId: record.personAccountId || record.id,
          recordName: record.name,
          text,
        })
      : null;

    const { error: logError } = await supabase.from("wisecall_salesforce_sms_messages").update({
        status: task.taskId ? "routed" : "route_failed",
        salesforce_task_id: task.taskId,
        detail: {
          reply_recipient_id: plan.binding.replyRoute.recipientId,
          ...(task.error ? { error: task.error } : {}),
          ...(notification ? { notified: notification.sent, ...(notification.error ? { notify_error: notification.error } : {}) } : {}),
        },
      }).eq("id", reservation.id);
    if (logError) throw new Error("Inbound Task outcome could not be stored; reconcile before retrying");

    if (!task.taskId) {
      return json(
        {
          ok: false,
          routed: true,
          delivered: false,
          error: task.error || "Salesforce task create failed.",
          record_id: record.id,
          reply_recipient_id: plan.binding.replyRoute.recipientId,
        },
        502,
      );
    }

    return json({
      ok: true,
      routed: true,
      delivered: true,
      record_id: record.id,
      reply_recipient_id: plan.binding.replyRoute.recipientId,
      salesforce_task_id: task.taskId,
    });
  } catch (error) {
    console.error("[salesforce-sms] inbound route failed", error instanceof Error ? error.message : error);
    return json({ ok: false, routed: true, delivered: false, error: "Salesforce reply routing failed." }, 502);
  }
}
