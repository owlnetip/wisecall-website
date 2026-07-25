import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBookAppointmentWebhook,
  buildCalendarBookingWebhooks,
  buildCheckAvailabilityWebhook,
  calendarBookingToolNames,
  isCalendarBookingWebhook,
  CALENDAR_BOOKING_PROMPT,
} from "./calendar-booking-template";
import { validateIntegrationWebhooks } from "./integration-webhooks";

const opts = { supabaseUrl: "https://example.supabase.co/", smsSecret: "shhh" };

test("the tool set matches the documented tool names and validates", () => {
  const hooks = buildCalendarBookingWebhooks(opts);
  assert.deepEqual(
    hooks.map((h) => h.name),
    calendarBookingToolNames,
  );
  assert.equal(validateIntegrationWebhooks(hooks), null);
});

test("every tool is a during-call POST to the booking function", () => {
  for (const hook of buildCalendarBookingWebhooks(opts)) {
    assert.equal(hook.condition, "during_call");
    assert.equal(hook.method, "POST");
    assert.equal(hook.enabled, true);
    // Trailing slash on the configured URL must not double up.
    assert.equal(hook.url, "https://example.supabase.co/functions/v1/wisecall-calendar-booking");
    assert.ok(hook.description.trim().length > 40, `${hook.name} needs a usable description`);
    assert.ok(hook.headers.some((h) => h.key === "X-WiseCall-SMS-Secret" && h.value === "shhh"));
  }
});

test("the shared secret header is omitted when there is no secret", () => {
  for (const hook of buildCalendarBookingWebhooks({ supabaseUrl: opts.supabaseUrl })) {
    assert.deepEqual(hook.headers, []);
  }
});

test("each tool pins its own action and carries the runtime call context", () => {
  const expected: Record<string, string> = {
    check_availability: "availability",
    book_appointment: "book",
    find_appointment: "lookup",
    reschedule_appointment: "reschedule",
    cancel_appointment: "cancel",
  };
  for (const hook of buildCalendarBookingWebhooks(opts)) {
    const params = new Map(hook.parameters.map((p) => [p.key, p.value]));
    assert.equal(params.get("action"), expected[hook.name]);
    assert.equal(params.get("profile_id"), "{{profile_id}}");
    assert.equal(params.get("call_id"), "{{call_id}}");
  }
});

// The runtime turns an empty parameter value into a required, AI-extracted
// argument, so an accidental extra blank parameter silently makes the tool
// harder for the model to call.
test("only the parameters the model must supply are left blank", () => {
  const aiFilled = (hook: { parameters: { key: string; value: string }[] }) =>
    hook.parameters.filter((p) => !p.value.trim()).map((p) => p.key);

  assert.deepEqual(aiFilled(buildCheckAvailabilityWebhook(opts)), ["service", "date"]);
  assert.deepEqual(aiFilled(buildBookAppointmentWebhook(opts)), [
    "service",
    "start",
    "name",
    "email",
  ]);
});

test("the caller's number is passed through rather than asked for", () => {
  const book = buildBookAppointmentWebhook(opts);
  assert.ok(book.parameters.some((p) => p.key === "phone" && p.value === "{{caller_id}}"));
});

test("booking tools are recognisable for connect/disconnect syncing", () => {
  for (const hook of buildCalendarBookingWebhooks(opts)) {
    assert.equal(isCalendarBookingWebhook(hook), true);
  }
  assert.equal(isCalendarBookingWebhook({ name: "request_viewing" }), false);
  assert.equal(isCalendarBookingWebhook({ name: "book_a_table" }), false);
});

test("the prompt section names every tool and forbids inventing slots", () => {
  for (const tool of calendarBookingToolNames) {
    assert.match(CALENDAR_BOOKING_PROMPT, new RegExp(tool));
  }
  assert.match(CALENDAR_BOOKING_PROMPT, /Only say the appointment is booked once/);
  assert.match(CALENDAR_BOOKING_PROMPT, /Never invent, hold or promise a slot/);
});
