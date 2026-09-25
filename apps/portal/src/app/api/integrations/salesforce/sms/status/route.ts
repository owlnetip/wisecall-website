import { NextResponse } from "next/server";
import { getSalesforceAccess } from "@/lib/salesforce-sms-client";
import { readSalesforceSmsEnv, secretsMatch } from "@/lib/salesforce-sms";
import { postStatusToSalesforce } from "@/lib/salesforce-sms-direct";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// SMS delivery receipt → Salesforce. Called by wisecall-sms-status when Vonage
// reports a final status for a Salesforce-originated SMS. Salesforce
// (WiseCallSmsReplyResource, type "status") updates the outbound SMS Task.

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return json({ ok: false, error: "not_configured" }, 503);
  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const profileId = String(body.profile_id || "").toLowerCase();
  const messageId = typeof body.message_id === "string" ? body.message_id : "";
  const status = typeof body.status === "string" ? body.status : "";
  if (!messageId || !status) return json({ ok: false, error: "message_id and status are required." }, 422);
  if (!read.config.profileIds.includes(profileId)) return json({ ok: false, error: "profile_not_enabled" }, 403);

  try {
    const access = await getSalesforceAccess(read.config);
    const result = await postStatusToSalesforce({
      access,
      recordId: typeof body.record_id === "string" ? body.record_id : null,
      messageId,
      status,
      error: typeof body.error === "string" ? body.error : null,
      at: typeof body.at === "string" ? body.at : null,
    });
    return json({ ok: result.ok, task_id: result.taskId, ...(result.error ? { error: result.error } : {}) }, result.ok ? 200 : 502);
  } catch (error) {
    console.error("[salesforce-sms] status forward failed", error instanceof Error ? error.message : error);
    return json({ ok: false, error: "Salesforce unreachable" }, 502);
  }
}
