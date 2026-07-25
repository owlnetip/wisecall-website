// wisecall-calendar-booking — the diary tools a voice agent uses on a live call.
//
// One endpoint, five actions, each wired up as a during-call integration webhook
// by the portal (see apps/portal/src/lib/calendar-booking-template.ts):
//
//   availability  → real free slots for a day, plus the next days that do have space
//   book          → creates the booking in the customer's own Cal.com account
//   lookup        → the caller's upcoming bookings, matched on their number
//   reschedule    → moves a booking to a new slot
//   cancel        → cancels a booking
//
// Every response carries a `message` written to be read aloud, so the model has
// something honest to say even when the answer is "no".
//
// Auth: X-WiseCall-SMS-Secret == WISECALL_SMS_WEBHOOK_SECRET
//   OR Authorization: Bearer <service role key>

// deno-lint-ignore-file no-explicit-any

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { normalisePhone, phoneCandidates } from "../_shared/viewing-confirm.ts";
import {
  calcomCancelBooking,
  calcomCreateBooking,
  calcomGetSlots,
  calcomRescheduleBooking,
  calendlyCreateSchedulingLink,
  calendlyGetAvailableTimes,
  formatDateTime,
  formatDayLabel,
  formatTimeOfDay,
  groupSlotsByDay,
  hasSlotAt,
  loadCalendarConnection,
  localDateKey,
  parseRequestedDate,
  resolveEventType,
  type CalendarConnection,
  type CalendarEventType,
} from "../_shared/calendar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-sms-secret",
};

const DEFAULT_TIMEZONE = "Europe/London";
const DEFAULT_MIN_NOTICE_MINS = 60;
const DEFAULT_LOOKAHEAD_DAYS = 10;
const MAX_SLOTS_OFFERED = 6;
const MAX_ALTERNATIVE_DAYS = 3;

type Action = "availability" | "book" | "lookup" | "reschedule" | "cancel";

type Body = {
  action?: string;
  profile_id?: string;
  profileId?: string;
  call_id?: string;
  callId?: string;
  service?: string;
  date?: string;
  start?: string;
  name?: string;
  email?: string;
  phone?: string;
  callerId?: string;
  notes?: string;
  booking_ref?: string;
  reason?: string;
};

type BookingRules = {
  min_notice_mins?: number;
  lookahead_days?: number;
  max_days_ahead?: number;
  fallback_attendee_email?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Tool-level failures come back 200 so the model reads `message` and keeps talking. */
function refusal(message: string, extra: Record<string, unknown> = {}) {
  return json({ success: false, message, ...extra });
}

function authorised(req: Request): boolean {
  const smsSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET") || "";
  const supplied = req.headers.get("X-WiseCall-SMS-Secret") || "";
  if (smsSecret && supplied === smsSecret) return true;

  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  if (svc && (auth === `Bearer ${svc}` || req.headers.get("apikey") === svc)) return true;
  return false;
}

function str(value: unknown, max = 200): string {
  return String(value ?? "").trim().slice(0, max);
}

function readBookingRules(metadata: Record<string, unknown> | null): BookingRules {
  const raw = metadata?.booking_rules;
  return raw && typeof raw === "object" ? (raw as BookingRules) : {};
}

/** Texts the caller a Calendly scheduling link (Calendly can't be booked server-side). */
async function sendSms(opts: {
  phone: string;
  message: string;
  profileId: string;
  callId: string | null;
}): Promise<boolean> {
  const secret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!secret || !supabaseUrl) return false;
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WiseCall-SMS-Secret": secret },
      body: JSON.stringify({
        phone: opts.phone,
        message: opts.message,
        link_type: "booking-link",
        call_id: opts.callId,
        profile_id: opts.profileId,
      }),
    });
    const result = await res.json().catch(() => ({}));
    return res.ok && Boolean(result.success);
  } catch (e) {
    console.error("[calendar-booking] sms:", (e as Error).message);
    return false;
  }
}

/**
 * Free slots from the requested day forwards, grouped by local day. One API call
 * covers both "what's free on Thursday" and "what's the next day that works",
 * which is the difference between one and several round trips mid-call.
 */
async function fetchSlotWindow(
  connection: CalendarConnection,
  eventType: CalendarEventType,
  fromDateKey: string,
  timeZone: string,
  rules: BookingRules,
): Promise<{ ok: boolean; error?: string; grouped: Map<string, string[]> }> {
  const lookaheadDays = Math.min(Math.max(rules.lookahead_days ?? DEFAULT_LOOKAHEAD_DAYS, 1), 30);
  const endDate = new Date(`${fromDateKey}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + lookaheadDays);
  const endDateKey = endDate.toISOString().slice(0, 10);

  const result =
    connection.provider === "calendly"
      ? await calendlyGetAvailableTimes(
          connection.access_token,
          String(eventType.id),
          `${fromDateKey}T00:00:00Z`,
          `${endDateKey}T00:00:00Z`,
        )
      : await calcomGetSlots(connection.access_token, {
          eventTypeId: eventType.id,
          start: fromDateKey,
          end: endDateKey,
          timeZone,
        });

  if (!result.ok) return { ok: false, error: result.error, grouped: new Map() };

  const minNotice = Math.max(rules.min_notice_mins ?? DEFAULT_MIN_NOTICE_MINS, 0);
  const earliest = Date.now() + minNotice * 60 * 1000;
  const bookable = result.slots.filter((slot) => new Date(slot).getTime() >= earliest);

  return { ok: true, grouped: groupSlotsByDay(bookable, timeZone) };
}

function spokenTimes(slots: string[], timeZone: string, limit: number): string[] {
  return slots.slice(0, limit).map((slot) => formatTimeOfDay(slot, timeZone));
}

function joinNaturally(values: string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} or ${values[values.length - 1]}`;
}

// ── actions ─────────────────────────────────────────────────────────────────

async function handleAvailability(ctx: Ctx) {
  const { body, connection, timeZone, rules } = ctx;
  const eventType = resolveEventType(connection, body.service);
  if (!eventType) {
    return refusal(
      "No bookable services have been set up in the diary yet, so take a message instead.",
      { services: [] },
    );
  }

  const dateKey =
    parseRequestedDate(body.date, timeZone) ?? localDateKey(new Date(), timeZone);

  const window = await fetchSlotWindow(connection, eventType, dateKey, timeZone, rules);
  if (!window.ok) {
    return refusal(
      "I can't reach the diary at the moment, so take the caller's details and tell them the team will confirm the time.",
      { error: window.error },
    );
  }

  const onRequestedDay = window.grouped.get(dateKey) ?? [];
  if (onRequestedDay.length) {
    const times = spokenTimes(onRequestedDay, timeZone, MAX_SLOTS_OFFERED);
    return json({
      success: true,
      service: eventType.title,
      duration_mins: eventType.duration_mins,
      date: dateKey,
      slots: onRequestedDay.slice(0, MAX_SLOTS_OFFERED).map((slot) => ({
        start: slot,
        time: formatTimeOfDay(slot, timeZone),
      })),
      message: `${formatDayLabel(dateKey, timeZone)} has ${joinNaturally(times)} free for ${eventType.title}. Offer up to three of these and book with the exact start value.`,
    });
  }

  const alternatives = [...window.grouped.entries()]
    .filter(([key]) => key > dateKey)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, MAX_ALTERNATIVE_DAYS)
    .map(([key, slots]) => ({
      date: key,
      day: formatDayLabel(key, timeZone),
      slots: slots.slice(0, 4).map((slot) => ({ start: slot, time: formatTimeOfDay(slot, timeZone) })),
    }));

  if (!alternatives.length) {
    return refusal(
      `There's nothing free for ${eventType.title} in the next couple of weeks. Say so honestly and take the caller's details so the team can call them back.`,
      { service: eventType.title, date: dateKey, slots: [] },
    );
  }

  const summary = alternatives
    .map((day) => `${day.day}: ${joinNaturally(day.slots.map((s) => s.time))}`)
    .join("; ");

  return json({
    success: true,
    service: eventType.title,
    date: dateKey,
    slots: [],
    alternative_days: alternatives,
    message: `Nothing free on ${formatDayLabel(dateKey, timeZone)}. The next available is — ${summary}. Offer the nearest of these.`,
  });
}

async function handleBook(ctx: Ctx) {
  const { supabase, body, profile, connection, timeZone, rules, callId } = ctx;

  const eventType = resolveEventType(connection, body.service);
  if (!eventType) {
    return refusal("No bookable services have been set up in the diary yet, so take a message instead.");
  }

  const startRaw = str(body.start, 60);
  const start = startRaw ? new Date(startRaw) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return refusal(
      "I need the exact slot start time from check_availability before I can book. Call check_availability first.",
    );
  }

  const maxDaysAhead = Math.max(rules.max_days_ahead ?? 365, 1);
  if (start.getTime() > Date.now() + maxDaysAhead * 24 * 60 * 60 * 1000) {
    return refusal(`That's further ahead than the diary takes bookings. Offer something within the next ${maxDaysAhead} days.`);
  }

  const name = str(body.name, 120);
  const phone = normalisePhone(str(body.phone || body.callerId, 40));
  const email = str(body.email, 200).toLowerCase();
  const attendeeEmail =
    email && email.includes("@")
      ? email
      : str(rules.fallback_attendee_email, 200) ||
        str((profile.metadata as Record<string, unknown> | null)?.default_routing_email, 200);

  if (!attendeeEmail || !attendeeEmail.includes("@")) {
    return refusal(
      "The diary needs an email address for the booking. Ask the caller for one, and if they don't have one tell them the team will confirm by phone instead.",
    );
  }

  // Calendly can't be booked server-side, so the caller gets a single-use link.
  if (connection.provider === "calendly") {
    const link = await calendlyCreateSchedulingLink(connection.access_token, String(eventType.id));
    if (!link.ok || !link.url) {
      return refusal("I can't reach the diary right now, so take the caller's details for the team.", {
        error: link.error,
      });
    }
    const sent =
      phone &&
      (await sendSms({
        phone,
        message: `${profile.business_name || "Booking"}: confirm your ${eventType.title} here — ${link.url}`,
        profileId: profile.id,
        callId,
      }));
    return json({
      success: true,
      mode: "link",
      booking_url: link.url,
      message: sent
        ? "I've texted them a link to confirm the time. Tell them to tap it and pick their slot."
        : "Read out that the team will send a booking link by text shortly — the link could not be sent automatically.",
    });
  }

  // Guard against booking a slot the model invented or one that has just gone.
  const dayKey = localDateKey(start, timeZone);
  const window = await fetchSlotWindow(connection, eventType, dayKey, timeZone, rules);
  if (window.ok && !hasSlotAt(window.grouped.get(dayKey) ?? [], start)) {
    const stillFree = spokenTimes(window.grouped.get(dayKey) ?? [], timeZone, 3);
    return refusal(
      stillFree.length
        ? `That time isn't free any more. Offer ${joinNaturally(stillFree)} instead, then book again.`
        : "That time isn't free any more, and there's nothing left that day. Call check_availability for another day.",
      { date: dayKey, slots: window.grouped.get(dayKey) ?? [] },
    );
  }

  const booking = await calcomCreateBooking(connection.access_token, {
    eventTypeId: eventType.id,
    start: start.toISOString(),
    name: name || "Phone caller",
    email: attendeeEmail,
    phone: phone || null,
    timeZone,
    notes: str(body.notes, 500) || null,
    metadata: { source: "wisecall_phone", profile_id: profile.id },
  });

  if (!booking.ok) {
    return refusal(
      "The diary wouldn't accept that booking. Apologise, take the caller's name and number, and tell them the team will confirm the time.",
      { error: booking.error },
    );
  }

  const durationMins = eventType.duration_mins ?? 30;
  const endsAt = booking.end ?? new Date(start.getTime() + durationMins * 60 * 1000).toISOString();

  const { error: writeError } = await supabase.from("wisecall_appointments").insert({
    profile_id: profile.id,
    provider: connection.provider,
    calendar_event_id: booking.uid,
    starts_at: booking.start ?? start.toISOString(),
    ends_at: endsAt,
    customer_name: name || null,
    customer_phone: phone || null,
    customer_email: email && email.includes("@") ? email : null,
    service_name: eventType.title,
    notes: str(body.notes, 1000) || null,
    status: "booked",
    source: "phone",
    call_id: callId,
  });
  if (writeError) {
    // The diary is the source of truth; a failed local write must not make the
    // agent tell the caller their confirmed booking failed.
    console.error("[calendar-booking] appointment write:", writeError.message);
  }

  const when = formatDateTime(booking.start ?? start.toISOString(), timeZone);
  return json({
    success: true,
    booking_ref: booking.uid,
    service: eventType.title,
    starts_at: booking.start ?? start.toISOString(),
    booked_for: when,
    message: `Booked: ${eventType.title} on ${when}. Confirm this back to the caller and mention a confirmation is on its way.`,
  });
}

async function handleLookup(ctx: Ctx) {
  const { supabase, body, profile, timeZone } = ctx;
  const candidates = phoneCandidates(str(body.phone || body.callerId, 40));
  if (!candidates.length) {
    return refusal("I need the caller's phone number to find their booking. Ask for the number they booked with.");
  }

  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from("wisecall_appointments")
    .select("id, calendar_event_id, starts_at, service_name, customer_name, status")
    .eq("profile_id", profile.id)
    .eq("status", "booked")
    .in("customer_phone", candidates)
    .gte("starts_at", since)
    .order("starts_at", { ascending: true })
    .limit(5);

  type AppointmentRow = {
    calendar_event_id: string | null;
    starts_at: string;
    service_name: string | null;
  };

  const appointments = ((data ?? []) as AppointmentRow[])
    .filter((row) => row.calendar_event_id)
    .map((row) => ({
      booking_ref: row.calendar_event_id as string,
      service: row.service_name,
      starts_at: row.starts_at,
      when: formatDateTime(row.starts_at, timeZone),
    }));

  if (!appointments.length) {
    return refusal(
      "I can't find a booking against this number. Ask whether it was booked under a different number or name, and take a message if so.",
      { appointments: [] },
    );
  }

  const summary = appointments
    .map((a) => `${a.service ?? "appointment"} on ${a.when}`)
    .join("; ");

  return json({
    success: true,
    appointments,
    message: `Found: ${summary}. Confirm out loud which one they mean before changing anything.`,
  });
}

/**
 * Only Cal.com bookings are ours to change — a Calendly booking was made by the
 * caller through their own link, so the agent must promise a callback instead of
 * silently doing nothing.
 */
function providerCannotEdit(connection: CalendarConnection, verb: string) {
  return refusal(
    `Bookings in this diary can't be ${verb} over the phone. Take the caller's name and number and tell them the team will sort it out and confirm.`,
    { provider: connection.provider },
  );
}

/** Confirms the booking belongs to this agent before letting it be changed. */
async function ownedAppointment(ctx: Ctx, bookingRef: string) {
  const { data } = await ctx.supabase
    .from("wisecall_appointments")
    .select("id, starts_at, service_name, status")
    .eq("profile_id", ctx.profile.id)
    .eq("calendar_event_id", bookingRef)
    .maybeSingle();
  return data as { id: string; starts_at: string; service_name: string | null; status: string } | null;
}

async function handleReschedule(ctx: Ctx) {
  const { supabase, body, connection, timeZone, rules } = ctx;
  if (connection.provider !== "cal_com") return providerCannotEdit(connection, "moved");

  const bookingRef = str(body.booking_ref, 120);
  if (!bookingRef) {
    return refusal("I need the booking reference from find_appointment first. Call find_appointment.");
  }

  const existing = await ownedAppointment(ctx, bookingRef);
  if (!existing) {
    return refusal("I can't find that booking on this diary. Call find_appointment and use the reference it gives you.");
  }

  const startRaw = str(body.start, 60);
  const start = startRaw ? new Date(startRaw) : null;
  if (!start || Number.isNaN(start.getTime())) {
    return refusal("I need the new slot start time from check_availability before I can move it.");
  }

  const eventType = resolveEventType(connection, existing.service_name ?? body.service);
  if (eventType) {
    const dayKey = localDateKey(start, timeZone);
    const window = await fetchSlotWindow(connection, eventType, dayKey, timeZone, rules);
    if (window.ok && !hasSlotAt(window.grouped.get(dayKey) ?? [], start)) {
      const stillFree = spokenTimes(window.grouped.get(dayKey) ?? [], timeZone, 3);
      return refusal(
        stillFree.length
          ? `That time isn't free. Offer ${joinNaturally(stillFree)} instead.`
          : "That time isn't free, and there's nothing else that day. Try another day.",
      );
    }
  }

  const moved = await calcomRescheduleBooking(
    connection.access_token,
    bookingRef,
    start.toISOString(),
    str(body.reason, 200) || null,
  );
  if (!moved.ok) {
    return refusal(
      "The diary wouldn't move that booking. Tell the caller the team will confirm the new time and take their details.",
      { error: moved.error },
    );
  }

  const newStart = moved.start ?? start.toISOString();
  await supabase
    .from("wisecall_appointments")
    .update({
      // Cal.com issues a new uid on reschedule, so the reference has to follow.
      calendar_event_id: moved.uid ?? bookingRef,
      starts_at: newStart,
      ends_at: moved.end ?? newStart,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id);

  const when = formatDateTime(newStart, timeZone);
  return json({
    success: true,
    booking_ref: moved.uid ?? bookingRef,
    starts_at: newStart,
    booked_for: when,
    message: `Moved to ${when}. Confirm the new day and time back to the caller.`,
  });
}

async function handleCancel(ctx: Ctx) {
  const { supabase, body, connection, timeZone } = ctx;
  if (connection.provider !== "cal_com") return providerCannotEdit(connection, "cancelled");

  const bookingRef = str(body.booking_ref, 120);
  if (!bookingRef) {
    return refusal("I need the booking reference from find_appointment first. Call find_appointment.");
  }

  const existing = await ownedAppointment(ctx, bookingRef);
  if (!existing) {
    return refusal("I can't find that booking on this diary. Call find_appointment and use the reference it gives you.");
  }

  const cancelled = await calcomCancelBooking(
    connection.access_token,
    bookingRef,
    str(body.reason, 200) || null,
  );
  if (!cancelled.ok) {
    return refusal(
      "The diary wouldn't cancel that booking. Tell the caller you've passed it to the team rather than saying it's cancelled.",
      { error: cancelled.error },
    );
  }

  await supabase
    .from("wisecall_appointments")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", existing.id);

  return json({
    success: true,
    message: `Cancelled the ${existing.service_name ?? "appointment"} on ${formatDateTime(existing.starts_at, timeZone)}. Confirm that to the caller.`,
  });
}

// ── entrypoint ──────────────────────────────────────────────────────────────

type Ctx = {
  supabase: any;
  body: Body;
  profile: { id: string; business_name: string | null; metadata: Record<string, unknown> | null };
  connection: CalendarConnection;
  timeZone: string;
  rules: BookingRules;
  callId: string | null;
};

const ACTIONS: Record<Action, (ctx: Ctx) => Promise<Response>> = {
  availability: handleAvailability,
  book: handleBook,
  lookup: handleLookup,
  reschedule: handleReschedule,
  cancel: handleCancel,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorised(req)) return json({ error: "Unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = str(body.action, 20).toLowerCase() as Action;
  if (!ACTIONS[action]) {
    return json({ error: `action must be one of ${Object.keys(ACTIONS).join(", ")}` }, 400);
  }

  const profileId = str(body.profileId || body.profile_id, 60);
  if (!profileId) return json({ error: "profile_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, timezone, metadata")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return json({ error: "profile not found" }, 404);

  const connection = await loadCalendarConnection(supabase, profileId);
  if (!connection) {
    return refusal(
      "No diary is connected to this agent, so you cannot book. Take the caller's name, number and preferred time and tell them the team will confirm.",
      { connected: false },
    );
  }

  const metadata = (profile.metadata as Record<string, unknown> | null) ?? {};
  const ctx: Ctx = {
    supabase,
    body,
    profile: {
      id: profile.id,
      business_name: profile.business_name ?? null,
      metadata,
    },
    connection,
    timeZone: str(profile.timezone, 60) || DEFAULT_TIMEZONE,
    rules: readBookingRules(metadata),
    callId: str(body.callId || body.call_id, 80) || null,
  };

  try {
    return await ACTIONS[action](ctx);
  } catch (e) {
    console.error(`[calendar-booking] ${action}:`, (e as Error).message);
    return refusal(
      "Something went wrong reaching the diary. Take the caller's details and tell them the team will confirm.",
      { error: (e as Error).message },
    );
  }
});
