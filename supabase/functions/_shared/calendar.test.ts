// Run with: deno test supabase/functions/_shared/calendar.test.ts
//
// Covers the pure date/slot logic behind the diary tools. These are the parts
// that decide which times a voice agent reads out, so a timezone slip here is
// the difference between offering a real slot and offering one an hour out.

import { assert, assertEquals, assertFalse } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  formatDateTime,
  formatDayLabel,
  formatTimeOfDay,
  groupSlotsByDay,
  hasSlotAt,
  localDateKey,
  parseRequestedDate,
  resolveEventType,
} from "./calendar.ts";

const LONDON = "Europe/London";

Deno.test("localDateKey uses the business timezone, not UTC", () => {
  // 23:30 UTC in July is already the next day in London (BST, UTC+1).
  assertEquals(localDateKey("2026-07-24T23:30:00Z", LONDON), "2026-07-25");
  assertEquals(localDateKey("2026-07-24T23:30:00Z", "UTC"), "2026-07-24");
  // In January there is no offset, so the two agree.
  assertEquals(localDateKey("2026-01-24T23:30:00Z", LONDON), "2026-01-24");
});

Deno.test("groupSlotsByDay buckets by local day so BST evenings don't leak", () => {
  const grouped = groupSlotsByDay(
    [
      "2026-07-24T08:00:00Z",
      "2026-07-24T16:00:00Z",
      // 23:30 UTC is 00:30 on the 25th in London.
      "2026-07-24T23:30:00Z",
      "2026-07-25T09:00:00Z",
    ],
    LONDON,
  );

  assertEquals([...grouped.keys()].sort(), ["2026-07-24", "2026-07-25"]);
  assertEquals(grouped.get("2026-07-24")?.length, 2);
  assertEquals(grouped.get("2026-07-25")?.length, 2);
});

Deno.test("parseRequestedDate accepts ISO, relative words and spoken dates", () => {
  const now = new Date("2026-07-24T10:00:00Z");

  assertEquals(parseRequestedDate("2026-08-03", LONDON, now), "2026-08-03");
  assertEquals(parseRequestedDate("2026-08-03T14:00:00Z", LONDON, now), "2026-08-03");
  assertEquals(parseRequestedDate("today", LONDON, now), "2026-07-24");
  assertEquals(parseRequestedDate("tomorrow", LONDON, now), "2026-07-25");
  assertEquals(parseRequestedDate("3 August 2026", LONDON, now), "2026-08-03");

  // Nothing usable must be reported as such rather than silently becoming today,
  // which would have the agent offer slots for a day nobody asked about.
  assertEquals(parseRequestedDate("", LONDON, now), null);
  assertEquals(parseRequestedDate("sometime next week", LONDON, now), null);
  assertEquals(parseRequestedDate(undefined, LONDON, now), null);
});

Deno.test("hasSlotAt tolerates second-level drift but not a different slot", () => {
  const slots = ["2026-07-24T09:00:00Z", "2026-07-24T09:30:00Z"];

  assert(hasSlotAt(slots, new Date("2026-07-24T09:00:00Z")));
  assert(hasSlotAt(slots, new Date("2026-07-24T09:00:30Z")));
  assertFalse(hasSlotAt(slots, new Date("2026-07-24T09:15:00Z")));
  assertFalse(hasSlotAt(slots, new Date("2026-07-24T10:00:00Z")));
  assertFalse(hasSlotAt([], new Date("2026-07-24T09:00:00Z")));
});

Deno.test("times and dates are spoken the way a receptionist would say them", () => {
  assertEquals(formatTimeOfDay("2026-07-24T08:30:00Z", LONDON), "9:30am");
  assertEquals(formatTimeOfDay("2026-07-24T13:00:00Z", LONDON), "2:00pm");
  assertEquals(formatDateTime("2026-07-24T08:30:00Z", LONDON), "Friday 24 July at 9:30am");
  assertEquals(formatDayLabel("2026-07-24", LONDON), "Friday 24 July");
});

Deno.test("resolveEventType matches what the caller asked for", () => {
  const connection = {
    event_types: [
      { id: 1, slug: "new-patient", title: "New patient checkup", duration_mins: 30 },
      { id: 2, slug: "hygiene", title: "Hygienist appointment", duration_mins: 45 },
    ],
  };

  assertEquals(resolveEventType(connection, "Hygienist appointment")?.id, 2);
  assertEquals(resolveEventType(connection, "hygiene")?.id, 2);
  // Callers say less than the full title, and sometimes more than it.
  assertEquals(resolveEventType(connection, "checkup")?.id, 1);
  assertEquals(resolveEventType(connection, "a new patient checkup please")?.id, 1);
  // No named service falls back to the first type rather than refusing to book.
  assertEquals(resolveEventType(connection, "")?.id, 1);
  assertEquals(resolveEventType(connection, "something else entirely")?.id, 1);
  assertEquals(resolveEventType({ event_types: [] }, "checkup"), null);
});
