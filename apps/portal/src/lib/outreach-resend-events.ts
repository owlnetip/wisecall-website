import { createHmac, timingSafeEqual } from "crypto";
import { getServiceSupabase } from "@/lib/supabase";

export type ResendOutreachEventType =
  | "email.sent"
  | "email.delivered"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.delivery_delayed"
  | string;

export type ResendOutreachEvent = {
  type: ResendOutreachEventType;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    subject?: string;
    [key: string]: unknown;
  };
};

/**
 * Verify a Resend (Svix) webhook signature without requiring the full SDK at
 * runtime when the secret is missing (dev). Prefer `svix` when installed.
 */
export async function verifyResendWebhook(
  payload: string,
  headers: {
    id: string | null;
    timestamp: string | null;
    signature: string | null;
  },
): Promise<{ ok: true; event: ResendOutreachEvent } | { ok: false; error: string }> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret) {
    // Soft-fail open only when explicitly allowed for local/dev.
    if (process.env.RESEND_WEBHOOK_ALLOW_UNSIGNED === "1") {
      try {
        return { ok: true, event: JSON.parse(payload) as ResendOutreachEvent };
      } catch {
        return { ok: false, error: "Invalid JSON payload." };
      }
    }
    return { ok: false, error: "RESEND_WEBHOOK_SECRET is not configured." };
  }

  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, error: "Missing Svix signature headers." };
  }

  try {
    const { Webhook } = await import("svix");
    const wh = new Webhook(secret);
    const event = wh.verify(payload, {
      "svix-id": headers.id,
      "svix-timestamp": headers.timestamp,
      "svix-signature": headers.signature,
    }) as ResendOutreachEvent;
    return { ok: true, event };
  } catch (err) {
    // Fallback: manual HMAC if svix import fails (should not in prod).
    try {
      const msg = `${headers.id}.${headers.timestamp}.${payload}`;
      const secretBytes = Buffer.from(
        secret.startsWith("whsec_") ? secret.slice(6) : secret,
        "base64",
      );
      const digest = createHmac("sha256", secretBytes).update(msg).digest("base64");
      const expected = `v1,${digest}`;
      const candidates = headers.signature.split(" ");
      const match = candidates.some((part) => {
        const a = Buffer.from(part);
        const b = Buffer.from(expected);
        return a.length === b.length && timingSafeEqual(a, b);
      });
      if (!match) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : "Invalid webhook signature.",
        };
      }
      return { ok: true, event: JSON.parse(payload) as ResendOutreachEvent };
    } catch (inner) {
      return {
        ok: false,
        error: inner instanceof Error ? inner.message : "Webhook verification failed.",
      };
    }
  }
}

/** Apply a verified Resend event to outreach email + prospect rollups. */
export async function applyResendOutreachEvent(input: {
  svixId: string;
  event: ResendOutreachEvent;
}): Promise<{ ok: true; handled: boolean; emailId?: string } | { ok: false; error: string }> {
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const eventType = input.event.type;
  const resendEmailId = input.event.data?.email_id ?? null;
  const occurredAt = input.event.created_at
    ? new Date(input.event.created_at).toISOString()
    : new Date().toISOString();

  // Idempotent insert — duplicate svix-id = already handled.
  const { error: insertErr } = await service.from("wisecall_outreach_email_events").insert({
    svix_id: input.svixId,
    event_type: eventType,
    resend_email_id: resendEmailId,
    payload: input.event as unknown as Record<string, unknown>,
  });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { ok: true, handled: false };
    }
    return { ok: false, error: insertErr.message };
  }

  if (!resendEmailId) {
    return { ok: true, handled: false };
  }

  const { data: emailRow } = await service
    .from("wisecall_outreach_emails")
    .select("id, prospect_id, sequence_step, opened_at, open_count, clicked_at, click_count, delivered_at, bounced_at, complained_at")
    .eq("resend_id", resendEmailId)
    .maybeSingle();

  if (!emailRow) {
    // Not an outreach email (product/transactional) — event logged, ignore.
    return { ok: true, handled: false };
  }

  const emailId = emailRow.id as string;
  const prospectId = emailRow.prospect_id as string;
  const patch: Record<string, unknown> = {
    last_event_at: occurredAt,
    updated_at: occurredAt,
  };

  if (eventType === "email.delivered") {
    patch.delivered_at = emailRow.delivered_at ?? occurredAt;
  } else if (eventType === "email.opened") {
    patch.opened_at = emailRow.opened_at ?? occurredAt;
    patch.open_count = ((emailRow.open_count as number) ?? 0) + 1;
  } else if (eventType === "email.clicked") {
    patch.clicked_at = emailRow.clicked_at ?? occurredAt;
    patch.click_count = ((emailRow.click_count as number) ?? 0) + 1;
    // A click implies an open.
    if (!emailRow.opened_at) patch.opened_at = occurredAt;
    if (!emailRow.open_count) patch.open_count = 1;
  } else if (eventType === "email.bounced") {
    patch.bounced_at = occurredAt;
    patch.status = "failed";
    patch.error_message = "Bounced";
  } else if (eventType === "email.complained") {
    patch.complained_at = occurredAt;
  }

  await service.from("wisecall_outreach_emails").update(patch).eq("id", emailId);
  await service
    .from("wisecall_outreach_email_events")
    .update({ email_row_id: emailId, prospect_id: prospectId })
    .eq("svix_id", input.svixId);

  // Prospect engagement rollup
  const prospectPatch: Record<string, unknown> = { updated_at: occurredAt };
  if (eventType === "email.opened" || eventType === "email.clicked") {
    const { data: prospect } = await service
      .from("wisecall_outreach_prospects")
      .select("first_email_opened_at, open_count")
      .eq("id", prospectId)
      .maybeSingle();
    if (prospect) {
      if (!prospect.first_email_opened_at) {
        prospectPatch.first_email_opened_at = occurredAt;
      }
      prospectPatch.last_opened_at = occurredAt;
      prospectPatch.open_count = ((prospect.open_count as number) ?? 0) + 1;
    }
  }
  if (eventType === "email.bounced" || eventType === "email.complained") {
    prospectPatch.sequence_status = "stopped";
    prospectPatch.next_follow_up_at = null;
    if (eventType === "email.complained") {
      prospectPatch.status = "not_interested";
    }
    await service
      .from("wisecall_outreach_emails")
      .update({ status: "cancelled", updated_at: occurredAt })
      .eq("prospect_id", prospectId)
      .eq("status", "scheduled");
  }

  if (Object.keys(prospectPatch).length > 1) {
    await service.from("wisecall_outreach_prospects").update(prospectPatch).eq("id", prospectId);
  }

  return { ok: true, handled: true, emailId };
}
