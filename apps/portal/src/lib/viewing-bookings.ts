/**
 * Property viewing owner-confirm flow helpers (Purplebricks / Strike style).
 * Edge functions own the messaging; the portal uses these for UI + unit tests.
 */

export type ViewingStatus =
  | "requested"
  | "pending_owner"
  | "confirmed"
  | "declined"
  | "change_requested"
  | "cancelled"
  | "expired"
  | "completed";

export type ViewingIntent = "approve" | "decline" | "change" | "ok" | "unknown";

export type PropertyRow = {
  id: string;
  profile_id: string;
  address: string;
  postcode: string | null;
  listing_ref: string | null;
  listing_url: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_preferred_channel: string;
  is_active: boolean;
  created_at: string;
};

export type ViewingRequestRow = {
  id: string;
  profile_id: string;
  property_id: string | null;
  property_address: string;
  listing_ref: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  viewer_name: string | null;
  viewer_phone: string | null;
  proposed_starts_at: string;
  proposed_ends_at: string;
  status: ViewingStatus;
  owner_channel: string | null;
  agent_available: boolean | null;
  agent_availability_note: string | null;
  day_before_still_ok_sent_at: string | null;
  day_of_reminder_sent_at: string | null;
  source: string;
  created_at: string;
};

const APPROVE = new Set(["yes", "y", "ok", "okay", "confirm", "confirmed", "approve", "approved", "fine", "sure"]);
const DECLINE = new Set(["no", "n", "decline", "declined", "reject", "rejected", "cant", "can't", "cannot"]);
const CHANGE = new Set(["change", "move", "reschedule", "different", "another"]);

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

export function formatViewingSlot(iso: string, timeZone = "Europe/London"): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function viewingStatusLabel(status: ViewingStatus | string): string {
  switch (status) {
    case "requested":
      return "Requested";
    case "pending_owner":
      return "Waiting on owner";
    case "confirmed":
      return "Confirmed";
    case "declined":
      return "Owner declined";
    case "change_requested":
      return "Change requested";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    case "completed":
      return "Completed";
    default:
      return status;
  }
}
