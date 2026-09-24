import { NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  createSalesforceSmsTask,
  getSalesforceAccess,
  lookupSalesforceByPhone,
  sendVonageSms,
} from "@/lib/salesforce-sms-client";
import {
  canonicalSmsDigits,
  decideSalesforceSms,
  executeSalesforceOutbound,
  heldDecisionResponse,
  normaliseSmsDestination,
  parseOutboundSmsBody,
  readSalesforceSmsEnv,
  secretsMatch,
  type SalesforceSmsDeps,
} from "@/lib/salesforce-sms";
import {
  findSentSms,
  loadSmsBinding,
  resolveAgentSmsNumber,
  saveSmsBinding,
  saveSmsMessage,
} from "@/lib/salesforce-sms-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Salesforce → Vonage SMS.
// Match the destination with a Salesforce phone lookup. Duplicate records and
// the reply recipient must be confirmed before a text is sent. A confirmed
// mapping is stored and reused until the live match set changes.
//
// Auth: x-wisecall-salesforce-secret
// POST sends (or returns the confirmation the flow still needs).
// GET looks up the number and reports the same confirmation state without sending.

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status });
}

function configuredOrError() {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return { error: json({ ok: false, error: read.error }, 503) };
  return { config: read.config };
}

function authorized(request: Request, secret: string) {
  return secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", secret);
}

function profileAllowed(profileId: string, profileIds: string[]) {
  return profileIds.includes(profileId.toLowerCase());
}

export async function GET(request: Request) {
  const setup = configuredOrError();
  if ("error" in setup) return setup.error;
  if (!authorized(request, setup.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const url = new URL(request.url);
  const profileId = (url.searchParams.get("profile_id") || "").trim().toLowerCase();
  const to = url.searchParams.get("to") || url.searchParams.get("phone") || "";
  const phone = normaliseSmsDestination(to);
  const digits = canonicalSmsDigits(to);
  if (!profileId || !phone || !digits) {
    return json({ ok: false, error: "profile_id and to are required." }, 422);
  }
  if (!profileAllowed(profileId, setup.config.profileIds)) {
    return json({ ok: false, error: "This agent is not enabled for Salesforce SMS." }, 403);
  }

  const supabase = getServiceSupabase();
  if (!supabase) return json({ ok: false, error: "Server not configured." }, 503);

  try {
    const access = await getSalesforceAccess(setup.config);
    const [matches, binding] = await Promise.all([
      lookupSalesforceByPhone({ access, digits }),
      loadSmsBinding(supabase, profileId, digits),
    ]);
    const decision = decideSalesforceSms({ matches, binding });
    if (decision.status === "send") {
      return json({
        ok: true,
        status: "ready",
        phone,
        reused_confirmation: true,
        record: {
          id: decision.record.id,
          object_type: decision.record.objectType,
          name: decision.record.name,
        },
        reply_route: {
          type: decision.replyRoute.type,
          recipient_id: decision.replyRoute.recipientId,
          recipient_name: decision.replyRoute.recipientName,
          recipient_email: decision.replyRoute.recipientEmail,
        },
        message: "This number already has a confirmed Salesforce record and reply recipient.",
      });
    }
    const held = heldDecisionResponse(decision, phone);
    return json(held.body, held.httpStatus);
  } catch (error) {
    console.error("[salesforce-sms] lookup failed", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Salesforce number lookup failed." }, 502);
  }
}

export async function POST(request: Request) {
  const setup = configuredOrError();
  if ("error" in setup) return setup.error;
  if (!authorized(request, setup.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }

  const parsed = parseOutboundSmsBody(payload, request.headers.get("idempotency-key"));
  if (!parsed.ok) return json({ ok: false, status: "invalid", message: parsed.error }, 422);
  if (!profileAllowed(parsed.value.profileId, setup.config.profileIds)) {
    return json({ ok: false, error: "This agent is not enabled for Salesforce SMS." }, 403);
  }

  const apiKey = process.env.VONAGE_API_KEY?.trim() || "";
  const apiSecret = process.env.VONAGE_API_SECRET?.trim() || "";
  if (!apiKey || !apiSecret) {
    return json({ ok: false, error: "Vonage credentials are not configured." }, 503);
  }

  const supabase = getServiceSupabase();
  if (!supabase) return json({ ok: false, error: "Server not configured." }, 503);

  try {
    const access = await getSalesforceAccess(setup.config);
    const deps: SalesforceSmsDeps = {
      lookup: (digits) => lookupSalesforceByPhone({ access, digits }),
      loadBinding: (profileId, phoneDigits) => loadSmsBinding(supabase, profileId, phoneDigits),
      saveBinding: (binding) => saveSmsBinding(supabase, binding),
      findSent: (profileId, idempotencyKey) => findSentSms(supabase, profileId, idempotencyKey),
      saveMessage: (row) => saveSmsMessage(supabase, { ...row, direction: "outbound" }),
      sendSms: ({ from, to, text }) => sendVonageSms({ apiKey, apiSecret, from, to, text }),
      logSalesforceTask: (input) => createSalesforceSmsTask({ access, ...input }),
      recordUsage: async (profileId) => {
        const { error } = await supabase.rpc("wisecall_record_sms_message", { p_profile_id: profileId });
        if (error) console.error("[salesforce-sms] usage", error.message);
      },
      resolveFromNumber: (profileId) => resolveAgentSmsNumber(supabase, profileId),
    };
    const result = await executeSalesforceOutbound(parsed.value, deps);
    return json(result.body, result.httpStatus);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salesforce SMS send failed.";
    console.error("[salesforce-sms] send failed", message);
    const safe = /vonage/i.test(message) ? message : "Salesforce SMS send failed.";
    return json({ ok: false, error: safe }, 502);
  }
}
