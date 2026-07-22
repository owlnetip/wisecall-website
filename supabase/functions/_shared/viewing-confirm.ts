// Shared viewing-confirmation helpers for SMS / WhatsApp inbound handlers
// and the viewing-request / viewing-reminders edge functions.

// deno-lint-ignore-file no-explicit-any

export type ViewingIntent = "approve" | "decline" | "change" | "ok" | "unknown";

export type ViewingRequestRow = {
  id: string;
  profile_id: string;
  property_address: string;
  listing_ref: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  viewer_name: string | null;
  viewer_phone: string | null;
  viewer_email: string | null;
  proposed_starts_at: string;
  proposed_ends_at: string;
  status: string;
  day_before_still_ok_sent_at: string | null;
  day_before_still_ok_response: string | null;
};

const VIEWING_SELECT =
  "id, profile_id, property_address, listing_ref, owner_name, owner_phone, viewer_name, viewer_phone, viewer_email, proposed_starts_at, proposed_ends_at, status, day_before_still_ok_sent_at, day_before_still_ok_response";

const APPROVE = new Set(["yes", "y", "ok", "okay", "confirm", "confirmed", "approve", "approved", "fine", "sure"]);
const DECLINE = new Set(["no", "n", "decline", "declined", "reject", "rejected", "cant", "can't", "cannot"]);
const CHANGE = new Set(["change", "move", "reschedule", "different", "another"]);

export function normalisePhone(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function phoneCandidates(value: string): string[] {
  const e164 = normalisePhone(value);
  if (!e164) return [];
  const digits = e164.replace(/\D/g, "");
  const out = new Set<string>([e164, digits]);
  if (digits.startsWith("44") && digits.length >= 12) {
    out.add(`0${digits.slice(2)}`);
    out.add(`+${digits}`);
  }
  if (digits.startsWith("0") && digits.length >= 11) {
    out.add(`+44${digits.slice(1)}`);
    out.add(`44${digits.slice(1)}`);
  }
  return [...out];
}

/** Parse a short SMS/WhatsApp reply into a viewing intent. */
export function parseViewingReply(raw: string): ViewingIntent {
  const text = (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[!.,?]+$/g, "")
    .replace(/\s+/g, " ");
  if (!text) return "unknown";

  const tokens = text.split(/[\s,/]+/).filter(Boolean);
  if (
    CHANGE.has(text) ||
    tokens.some((t) => CHANGE.has(t)) ||
    text.includes("reschedule") ||
    text.includes("another time")
  ) {
    return "change";
  }
  if (DECLINE.has(text) || tokens.some((t) => DECLINE.has(t))) {
    return "decline";
  }
  if (text === "ok" || text === "okay" || text === "still ok" || text === "still okay") {
    return "ok";
  }
  if (APPROVE.has(text) || tokens.some((t) => APPROVE.has(t))) {
    return "approve";
  }
  return "unknown";
}

export function formatUkSlot(iso: string, timeZone = "Europe/London"): string {
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return iso;
  }
}

export function ownerAskMessage(opts: {
  businessName: string;
  viewerName: string | null;
  address: string;
  startsAt: string;
}): string {
  const who = opts.viewerName?.trim() || "Someone";
  const when = formatUkSlot(opts.startsAt);
  return (
    `${opts.businessName}: ${who} would like to view ${opts.address} on ${when}. ` +
    `Reply YES to confirm, NO to decline, or CHANGE to suggest another time.`
  ).slice(0, 612);
}

export function viewerConfirmedMessage(opts: {
  businessName: string;
  address: string;
  startsAt: string;
}): string {
  const when = formatUkSlot(opts.startsAt);
  return (
    `${opts.businessName}: your viewing at ${opts.address} is confirmed for ${when}. ` +
    `We'll remind you the day before. Reply CHANGE if you need to move it.`
  ).slice(0, 612);
}

export function viewerDeclinedMessage(opts: {
  businessName: string;
  address: string;
}): string {
  return (
    `${opts.businessName}: the owner couldn't make that time for ${opts.address}. ` +
    `We'll be in touch to arrange another slot.`
  ).slice(0, 612);
}

export function changeAckMessage(opts: { businessName: string }): string {
  return (
    `${opts.businessName}: thanks — we've noted you'd like to change the viewing. ` +
    `The team will follow up shortly with new times.`
  ).slice(0, 612);
}

export function dayBeforeStillOkMessage(opts: {
  businessName: string;
  address: string;
  startsAt: string;
  party: "owner" | "viewer";
}): string {
  const when = formatUkSlot(opts.startsAt);
  const who = opts.party === "owner" ? "the viewer" : "you";
  return (
    `${opts.businessName}: reminder — viewing at ${opts.address} tomorrow (${when}). ` +
    `Just checking ${who} are still ok. Reply OK if fine, or CHANGE to move it.`
  ).slice(0, 612);
}

export function dayOfReminderMessage(opts: {
  businessName: string;
  address: string;
  startsAt: string;
  counterpartyName: string | null;
  counterpartyPhone: string | null;
}): string {
  const when = formatUkSlot(opts.startsAt);
  const other = [opts.counterpartyName, opts.counterpartyPhone].filter(Boolean).join(" · ");
  return (
    `${opts.businessName}: today — viewing at ${opts.address} at ${when}` +
    (other ? ` (${other})` : "") +
    `. Reply CHANGE if you need to move it.`
  ).slice(0, 612);
}

async function logMessage(
  supabase: any,
  row: {
    viewing_request_id: string;
    profile_id: string;
    direction: "outbound" | "inbound";
    channel: "sms" | "whatsapp" | "email";
    party: "owner" | "viewer" | "agent";
    to_address?: string;
    from_address?: string;
    body: string;
    purpose: string;
    provider_message_id?: string;
  },
) {
  try {
    await supabase.from("wisecall_viewing_messages").insert(row);
  } catch (e) {
    console.error("[viewing-confirm] log message:", (e as Error).message);
  }
}

export type ViewingReplyResult =
  | { handled: false }
  | {
      handled: true;
      intent: ViewingIntent;
      viewingId: string;
      replyText: string;
      status: string;
    };

type SendFn = (to: string, text: string) => Promise<void>;

/** Prefer the shared Vonage SMS helper for viewer confirmations (works without WhatsApp). */
async function sendViewerSms(to: string, text: string, profileId: string, purpose: string): Promise<boolean> {
  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!expectedSecret || !supabaseUrl) return false;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-WiseCall-SMS-Secret": expectedSecret,
      },
      body: JSON.stringify({
        phone: to,
        message: text,
        link_type: `viewing-${purpose}-${profileId.slice(0, 6)}`,
        profile_id: profileId,
      }),
    });
    const result = await res.json().catch(() => ({}));
    return res.ok && !!result.success;
  } catch (e) {
    console.error("[viewing-confirm] viewer sms:", (e as Error).message);
    return false;
  }
}

async function findByPhones(
  supabase: any,
  profileId: string,
  column: "owner_phone" | "viewer_phone",
  candidates: string[],
  statuses: string[],
): Promise<ViewingRequestRow | null> {
  const { data, error } = await supabase
    .from("wisecall_viewing_requests")
    .select(VIEWING_SELECT)
    .eq("profile_id", profileId)
    .in(column, candidates)
    .in("status", statuses)
    .order("proposed_starts_at", { ascending: true })
    .limit(1);
  if (error) {
    console.error("[viewing-confirm] find:", error.message);
    return null;
  }
  return (data?.[0] as ViewingRequestRow | undefined) ?? null;
}

/**
 * If the inbound sender matches an open viewing request (owner pending, or
 * confirmed day-before loop), apply the state transition and return a reply.
 * Callers should send `replyText` and skip the normal AI receptionist path.
 */
export async function tryHandleViewingReply(opts: {
  supabase: any;
  profileId: string;
  fromPhone: string;
  body: string;
  channel: "sms" | "whatsapp";
  businessName: string;
  sendTo?: SendFn;
}): Promise<ViewingReplyResult> {
  const { supabase, profileId, fromPhone, body, channel, businessName } = opts;
  const intent = parseViewingReply(body);
  if (intent === "unknown") return { handled: false };

  const candidates = phoneCandidates(fromPhone);
  if (!candidates.length) return { handled: false };

  // 1) Owner pending approval
  const pending = await findByPhones(supabase, profileId, "owner_phone", candidates, ["pending_owner"]);
  if (pending) {
    await logMessage(supabase, {
      viewing_request_id: pending.id,
      profile_id: profileId,
      direction: "inbound",
      channel,
      party: "owner",
      from_address: fromPhone,
      body,
      purpose: "reply",
    });

    const now = new Date().toISOString();
    if (intent === "approve" || intent === "ok") {
      await supabase
        .from("wisecall_viewing_requests")
        .update({
          status: "confirmed",
          owner_responded_at: now,
          owner_response_raw: body.slice(0, 500),
          confirmed_at: now,
          updated_at: now,
        })
        .eq("id", pending.id);

      const viewerMsg = viewerConfirmedMessage({
        businessName,
        address: pending.property_address,
        startsAt: pending.proposed_starts_at,
      });
      if (pending.viewer_phone) {
        let sent = await sendViewerSms(pending.viewer_phone, viewerMsg, profileId, "confirm");
        if (!sent && opts.sendTo) {
          try {
            await opts.sendTo(pending.viewer_phone, viewerMsg);
            sent = true;
          } catch (e) {
            console.error("[viewing-confirm] viewer confirm send:", (e as Error).message);
          }
        }
        if (sent) {
          await supabase
            .from("wisecall_viewing_requests")
            .update({ confirmation_sent_to_viewer_at: now, updated_at: now })
            .eq("id", pending.id);
          await logMessage(supabase, {
            viewing_request_id: pending.id,
            profile_id: profileId,
            direction: "outbound",
            channel: "sms",
            party: "viewer",
            to_address: pending.viewer_phone,
            body: viewerMsg,
            purpose: "confirm_viewer",
          });
        }
      }

      return {
        handled: true,
        intent: "approve",
        viewingId: pending.id,
        status: "confirmed",
        replyText: `Thanks — viewing confirmed for ${formatUkSlot(pending.proposed_starts_at)}. We'll remind you the day before.`,
      };
    }

    if (intent === "decline") {
      await supabase
        .from("wisecall_viewing_requests")
        .update({
          status: "declined",
          owner_responded_at: now,
          owner_response_raw: body.slice(0, 500),
          updated_at: now,
        })
        .eq("id", pending.id);

      if (pending.viewer_phone) {
        const declineMsg = viewerDeclinedMessage({
          businessName,
          address: pending.property_address,
        });
        let sent = await sendViewerSms(pending.viewer_phone, declineMsg, profileId, "decline");
        if (!sent && opts.sendTo) {
          try {
            await opts.sendTo(pending.viewer_phone, declineMsg);
            sent = true;
          } catch (e) {
            console.error("[viewing-confirm] viewer decline send:", (e as Error).message);
          }
        }
        if (sent) {
          await logMessage(supabase, {
            viewing_request_id: pending.id,
            profile_id: profileId,
            direction: "outbound",
            channel: "sms",
            party: "viewer",
            to_address: pending.viewer_phone,
            body: declineMsg,
            purpose: "decline_viewer",
          });
        }
      }

      return {
        handled: true,
        intent: "decline",
        viewingId: pending.id,
        status: "declined",
        replyText: "Understood — we've let the viewer know and will arrange another time.",
      };
    }

    if (intent === "change") {
      await supabase
        .from("wisecall_viewing_requests")
        .update({
          status: "change_requested",
          owner_responded_at: now,
          owner_response_raw: body.slice(0, 500),
          updated_at: now,
        })
        .eq("id", pending.id);

      return {
        handled: true,
        intent: "change",
        viewingId: pending.id,
        status: "change_requested",
        replyText: changeAckMessage({ businessName }),
      };
    }
  }

  // 2) Day-before still-ok / change on a confirmed viewing (owner or viewer)
  const asOwner = await findByPhones(supabase, profileId, "owner_phone", candidates, [
    "confirmed",
    "change_requested",
  ]);
  const asViewer = asOwner
    ? null
    : await findByPhones(supabase, profileId, "viewer_phone", candidates, [
        "confirmed",
        "change_requested",
      ]);
  const row = asOwner || asViewer;
  if (!row) return { handled: false };
  if (!row.day_before_still_ok_sent_at && intent !== "change") return { handled: false };

  const party: "owner" | "viewer" = asOwner ? "owner" : "viewer";
  await logMessage(supabase, {
    viewing_request_id: row.id,
    profile_id: profileId,
    direction: "inbound",
    channel,
    party,
    from_address: fromPhone,
    body,
    purpose: "reply",
  });

  const now = new Date().toISOString();
  if (intent === "change") {
    await supabase
      .from("wisecall_viewing_requests")
      .update({
        status: "change_requested",
        day_before_still_ok_response: "change",
        updated_at: now,
      })
      .eq("id", row.id);
    return {
      handled: true,
      intent: "change",
      viewingId: row.id,
      status: "change_requested",
      replyText: changeAckMessage({ businessName }),
    };
  }

  if (intent === "ok" || intent === "approve") {
    await supabase
      .from("wisecall_viewing_requests")
      .update({
        day_before_still_ok_response: "ok",
        updated_at: now,
      })
      .eq("id", row.id);
    return {
      handled: true,
      intent: "ok",
      viewingId: row.id,
      status: row.status,
      replyText: `Perfect — see you ${formatUkSlot(row.proposed_starts_at)} at ${row.property_address}.`,
    };
  }

  return { handled: false };
}
