// Run with: deno test supabase/functions/_shared/staff-alert-sms.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildStaffAlertSms,
  staffAlertNumbers,
  toE164,
} from "./staff-alert-sms.ts";

Deno.test("normalises UK mobiles to E.164", () => {
  assertEquals(toE164("07825395792"), "+447825395792");
  assertEquals(toE164("07825 395 792"), "+447825395792");
  assertEquals(toE164("+447825395792"), "+447825395792");
  assertEquals(toE164("447825395792"), "+447825395792");
  assertEquals(toE164("unknown"), null);
  assertEquals(toE164(""), null);
});

Deno.test("skips staff alerts when SMS is disabled on the agent", () => {
  assertEquals(
    staffAlertNumbers(
      { staff_alert_sms: { enabled: true, numbers: ["07825395792"] } },
      false,
    ),
    [],
  );
});

Deno.test("reads staff_alert_sms numbers when the agent allows SMS", () => {
  assertEquals(
    staffAlertNumbers(
      {
        staff_alert_sms: {
          mode: "all",
          enabled: true,
          numbers: ["07825395792", "07801500525", "07825395792"],
        },
      },
      true,
    ),
    ["+447825395792", "+447801500525"],
  );
});

Deno.test("mode first texts only the first valid mobile", () => {
  assertEquals(
    staffAlertNumbers(
      {
        staff_alert_sms: {
          mode: "first",
          enabled: true,
          numbers: ["07825395792", "07801500525"],
        },
      },
      true,
    ),
    ["+447825395792"],
  );
});

Deno.test("builds a compact staff SMS without the transcript", () => {
  const text = buildStaffAlertSms({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary:
      "Caller Luke Test said: I've got a red broadband light. Follow-up/callback requested.",
    actionItems: ["Call Luke back about broadband"],
  });
  if (!text.startsWith("Excel Telecom: call from 07825395792.")) {
    throw new Error(text);
  }
  if (!text.includes("Call Luke back about broadband")) throw new Error(text);
  if (!text.includes("red broadband light")) throw new Error(text);
  if (text.length > 480) throw new Error("too long");
});
