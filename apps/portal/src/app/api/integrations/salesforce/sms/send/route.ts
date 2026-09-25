import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { readSalesforceSmsEnv, secretsMatch } from "@/lib/salesforce-sms";
import { parseDirectSendBody, saveDirectBinding } from "@/lib/salesforce-sms-direct";
import { findSentSms, resolveAgentSmsNumber, saveSmsMessage, SmsMessageDuplicateError } from "@/lib/salesforce-sms-store";
import { sendViaAgentSms, smsRequestId } from "@/lib/salesforce-sms-transport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Salesforce → WiseCall → Vonage (BetterMove architecture, 25 Sep 2026).
// Called by Salesforce's WiseCallSms.send via the WiseCall_SMS Named Credential.
//   POST { profile_id, record_id, phone, text, from? }  + Idempotency-Key header
// Salesforce has already chosen the record and merged the template; WiseCall
// sends, and remembers record_id so replies are handed back with it.

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return json({ ok: false, error: read.error }, 503);
  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const parsed = parseDirectSendBody(payload, request.headers.get("idempotency-key"));
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 422);
  const send = parsed.value;
  if (!read.config.profileIds.includes(send.profileId)) {
    return json({ ok: false, error: "This agent is not enabled for Salesforce SMS." }, 403);
  }

  const supabase = getServiceSupabase();
  if (!supabase) return json({ ok: false, error: "Server not configured." }, 503);

  try {
    if (send.idempotencyKey) {
      const prior = await findSentSms(supabase, send.profileId, send.idempotencyKey);
      if (prior) return json({ ...prior.body, idempotent_replay: true });
    }

    const sender = await resolveAgentSmsNumber(supabase, send.profileId, send.from);
    if (!sender.ok) return json({ ok: false, error: sender.message }, 422);

    const digits = send.to.slice(1);
    // Store the thread before sending so an instant reply already routes back.
    const bindingId = await saveDirectBinding(supabase, {
      profileId: send.profileId, phoneDigits: digits, recordId: send.recordId, object: send.object,
    });

    const requestId = smsRequestId(send.profileId, send.idempotencyKey);
    const sent = await sendViaAgentSms({
      invoke: (name, options) => supabase.functions.invoke(name, options),
      profileId: send.profileId, requestId, from: sender.from, to: send.to, text: send.text,
    });

    const result = {
      ok: true,
      status: "sent",
      message_id: sent.messageId,
      from: sender.from,
      phone: send.to,
      record_id: send.recordId,
    };
    try {
      await saveSmsMessage(supabase, {
        profileId: send.profileId, bindingId, direction: "outbound", phoneDigits: digits, body: send.text,
        status: "sent", salesforceRecordId: send.recordId, salesforceTaskId: null,
        providerMessageId: sent.messageId, idempotencyKey: send.idempotencyKey, detail: result,
      });
    } catch (error) {
      if (!(error instanceof SmsMessageDuplicateError)) {
        console.error("[salesforce-sms] sent but not logged", error instanceof Error ? error.message : error);
      }
    }
    return json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "SMS send failed.";
    console.error("[salesforce-sms] direct send failed", message);
    return json({ ok: false, error: /vonage|sms service|number/i.test(message) ? message : "SMS send failed." }, 502);
  }
}
