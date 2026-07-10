import { NextResponse } from "next/server";
import {
  applyResendOutreachEvent,
  verifyResendWebhook,
} from "@/lib/outreach-resend-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend webhook for outreach engagement tracking.
 *
 * Configure in Resend dashboard → Webhooks:
 *   URL: https://app.wisecall.io/api/webhooks/resend
 *   Events: email.delivered, email.opened, email.clicked, email.bounced, email.complained
 *   Secret → RESEND_WEBHOOK_SECRET
 *
 * Uses the raw body for Svix signature verification.
 */
export async function POST(req: Request) {
  const payload = await req.text();
  const verified = await verifyResendWebhook(payload, {
    id: req.headers.get("svix-id"),
    timestamp: req.headers.get("svix-timestamp"),
    signature: req.headers.get("svix-signature"),
  });

  if (!verified.ok) {
    return NextResponse.json({ ok: false, error: verified.error }, { status: 400 });
  }

  const svixId = req.headers.get("svix-id") || `local-${Date.now()}`;
  const result = await applyResendOutreachEvent({
    svixId,
    event: verified.event,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    handled: result.handled,
    emailId: result.emailId ?? null,
    type: verified.event.type,
  });
}
