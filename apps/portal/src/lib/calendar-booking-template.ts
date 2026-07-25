/**
 * Diary booking tools for agents that book into a connected scheduling tool
 * (Cal.com today, Calendly link-out). The customer connects their own account
 * in the portal; these builders turn that connection into during-call tools the
 * voice runtime exposes to the model, all backed by the
 * wisecall-calendar-booking edge function.
 *
 * The runtime treats a parameter with a fixed value as "always send this" and a
 * parameter with an empty value as "the model must supply it", so the AI-filled
 * parameters are kept to the minimum the model can reliably extract on a call.
 */

import {
  newIntegrationWebhook,
  type IntegrationWebhook,
} from "@/lib/integration-webhooks";

export type CalendarBookingToolName =
  | "check_availability"
  | "book_appointment"
  | "find_appointment"
  | "reschedule_appointment"
  | "cancel_appointment";

export const calendarBookingToolNames: CalendarBookingToolName[] = [
  "check_availability",
  "book_appointment",
  "find_appointment",
  "reschedule_appointment",
  "cancel_appointment",
];

type BuildOpts = {
  supabaseUrl: string;
  smsSecret?: string | null;
};

function bookingEndpoint(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/$/, "")}/functions/v1/wisecall-calendar-booking`;
}

function bookingHeaders(smsSecret?: string | null): { key: string; value: string }[] {
  return smsSecret ? [{ key: "X-WiseCall-SMS-Secret", value: smsSecret }] : [];
}

/** Offers real open slots from the connected diary. */
export function buildCheckAvailabilityWebhook(opts: BuildOpts): IntegrationWebhook {
  return newIntegrationWebhook({
    name: "check_availability",
    friendlyName: "Check diary availability",
    description:
      "Look up genuinely free appointment slots in the connected diary for a given day. Call this before offering any time to the caller. service is the appointment type they want (pass an empty string if the business only offers one). date is the day they asked about as YYYY-MM-DD.",
    condition: "during_call",
    method: "POST",
    url: bookingEndpoint(opts.supabaseUrl),
    enabled: true,
    headers: bookingHeaders(opts.smsSecret),
    parameters: [
      { key: "action", value: "availability" },
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "service", value: "" },
      { key: "date", value: "" },
    ],
  });
}

/** Creates the real booking in the connected diary. */
export function buildBookAppointmentWebhook(opts: BuildOpts): IntegrationWebhook {
  return newIntegrationWebhook({
    name: "book_appointment",
    friendlyName: "Book appointment",
    description:
      "Book a confirmed appointment in the connected diary. Only call this for a slot check_availability has already returned, and only after the caller has agreed to it. start must be the exact slot start you were given. email may be an empty string if the caller has no email address.",
    condition: "during_call",
    method: "POST",
    url: bookingEndpoint(opts.supabaseUrl),
    enabled: true,
    headers: bookingHeaders(opts.smsSecret),
    parameters: [
      { key: "action", value: "book" },
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "phone", value: "{{caller_id}}" },
      { key: "service", value: "" },
      { key: "start", value: "" },
      { key: "name", value: "" },
      { key: "email", value: "" },
    ],
  });
}

/** Finds what the caller already has booked, so they never need a reference number. */
export function buildFindAppointmentWebhook(opts: BuildOpts): IntegrationWebhook {
  return newIntegrationWebhook({
    name: "find_appointment",
    friendlyName: "Find caller's appointments",
    description:
      "List the caller's upcoming appointments, matched on the number they are calling from. Call this first whenever they want to change or cancel something.",
    condition: "during_call",
    method: "POST",
    url: bookingEndpoint(opts.supabaseUrl),
    enabled: true,
    headers: bookingHeaders(opts.smsSecret),
    parameters: [
      { key: "action", value: "lookup" },
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "phone", value: "{{caller_id}}" },
    ],
  });
}

/** Moves an existing booking to a new slot. */
export function buildRescheduleAppointmentWebhook(opts: BuildOpts): IntegrationWebhook {
  return newIntegrationWebhook({
    name: "reschedule_appointment",
    friendlyName: "Reschedule appointment",
    description:
      "Move an existing booking to a different slot. booking_ref is the reference returned by find_appointment. start must be a slot check_availability has confirmed is free.",
    condition: "during_call",
    method: "POST",
    url: bookingEndpoint(opts.supabaseUrl),
    enabled: true,
    headers: bookingHeaders(opts.smsSecret),
    parameters: [
      { key: "action", value: "reschedule" },
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "booking_ref", value: "" },
      { key: "start", value: "" },
    ],
  });
}

/** Cancels an existing booking. */
export function buildCancelAppointmentWebhook(opts: BuildOpts): IntegrationWebhook {
  return newIntegrationWebhook({
    name: "cancel_appointment",
    friendlyName: "Cancel appointment",
    description:
      "Cancel an existing booking. booking_ref is the reference returned by find_appointment. Only call this once the caller has explicitly confirmed they want it cancelled.",
    condition: "during_call",
    method: "POST",
    url: bookingEndpoint(opts.supabaseUrl),
    enabled: true,
    headers: bookingHeaders(opts.smsSecret),
    parameters: [
      { key: "action", value: "cancel" },
      { key: "profile_id", value: "{{profile_id}}" },
      { key: "call_id", value: "{{call_id}}" },
      { key: "booking_ref", value: "" },
      { key: "reason", value: "Cancelled by caller on the phone" },
    ],
  });
}

/** The full diary tool set, in the order the agent normally uses it. */
export function buildCalendarBookingWebhooks(opts: BuildOpts): IntegrationWebhook[] {
  return [
    buildCheckAvailabilityWebhook(opts),
    buildBookAppointmentWebhook(opts),
    buildFindAppointmentWebhook(opts),
    buildRescheduleAppointmentWebhook(opts),
    buildCancelAppointmentWebhook(opts),
  ];
}

export function isCalendarBookingWebhook(hook: { name: string }): boolean {
  return (calendarBookingToolNames as string[]).includes(hook.name);
}

/**
 * Prompt section shared by every template that books into a connected diary.
 * The hard rule is the same one that keeps the Dentally template honest: never
 * tell the caller they are booked until the tool says so.
 */
export const CALENDAR_BOOKING_PROMPT = [
  "DIARY BOOKING (live, in the connected diary)",
  "You can see and change the real diary. Follow this order every time:",
  "1. Ask what they need and roughly when. Convert vague answers into a specific day (\"tomorrow\", \"Thursday\") before you look anything up.",
  "2. Call check_availability for that day, passing the service they asked for and the date as YYYY-MM-DD.",
  "3. Offer at most three of the returned times, in plain speech (\"ten past nine, half nine, or quarter to eleven\").",
  "4. When they pick one, take their name, and an email address if they have one, then call book_appointment with the exact slot start you were given.",
  "5. Only say the appointment is booked once book_appointment comes back successful. Read back the day, time and service, and tell them a confirmation is on its way.",
  "",
  "To change or cancel: call find_appointment first, confirm out loud which booking they mean, then call reschedule_appointment or cancel_appointment.",
  "",
  "If the diary has nothing suitable, say so honestly and offer the nearest days that do have space, or take a message for the team.",
  "Never invent, hold or promise a slot that check_availability has not returned.",
].join("\n");
