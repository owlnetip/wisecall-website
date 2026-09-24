import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { createSalesforceSmsTask, getSalesforceAccess } from "@/lib/salesforce-sms-client";
import {
  canonicalSmsDigits,
  normaliseSmsDestination,
  planInboundSalesforceReply,
  readSalesforceSmsEnv,
  secretsMatch,
  type SalesforceSmsRecord,
} from "@/lib/salesforce-sms";
import { loadSmsBinding, saveSmsMessage, SmsMessageDuplicateError } from "@/lib/salesforce-sms-store";

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
    const access = await getSalesforceAccess(read.config);
    const task = await createSalesforceSmsTask({
      access,
      record,
      replyRoute: plan.binding.replyRoute,
      phone,
      text,
      direction: "inbound",
    });

    try {
      await saveSmsMessage(supabase, {
        profileId,
        bindingId: plan.binding.id ?? null,
        direction: "inbound",
        phoneDigits: digits,
        body: text,
        status: task.taskId ? "routed" : "route_failed",
        salesforceRecordId: record.id,
        salesforceTaskId: task.taskId,
        providerMessageId: messageId,
        idempotencyKey: messageId ? `inbound:${messageId}` : null,
        detail: {
          reply_recipient_id: plan.binding.replyRoute.recipientId,
          ...(task.error ? { error: task.error } : {}),
        },
      });
    } catch (error) {
      if (error instanceof SmsMessageDuplicateError) {
        return json({
          ok: true,
          routed: true,
          delivered: true,
          idempotent_replay: true,
          record_id: record.id,
          reply_recipient_id: plan.binding.replyRoute.recipientId,
        });
      }
      console.error("[salesforce-sms] inbound log failed", error instanceof Error ? error.message : error);
    }

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
