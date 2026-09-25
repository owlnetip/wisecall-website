// Run with: deno test supabase/functions/_shared/staff-alert-sms.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractCompanyFromText,
  formatCallerDisplay,
  resolveCallerIdentity,
} from "./caller-identity.ts";
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

Deno.test("falls back to notify routing-contact mobiles", () => {
  assertEquals(
    staffAlertNumbers(
      {
        routing_contacts: [
          { notify: true, phone: "07825395792" },
          { notify: false, phone: "07801500525" },
          { notify: true, phone: "01132220000" },
        ],
      },
      true,
    ),
    ["+447825395792"],
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

Deno.test("staff SMS includes the caller's company, not only their name", () => {
  const text = buildStaffAlertSms({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    callerName: "Luke",
    company: "Northwind Ltd",
    summary: "Caller Luke asked for a callback about broadband.",
    actionItems: ["Call Luke back about broadband"],
  });
  if (!text.startsWith("Excel Telecom: Luke at Northwind Ltd called from 07825395792.")) {
    throw new Error(text);
  }
  if (!text.includes("Call Luke back about broadband")) throw new Error(text);
});

Deno.test("staff SMS still names the business when company was not captured", () => {
  const text = buildStaffAlertSms({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "Callback requested.",
  });
  if (!text.startsWith("Excel Telecom: Luke called from 07825395792.")) {
    throw new Error(text);
  }
});

Deno.test("resolves company from analysis and collected fields", () => {
  const fromAnalysis = resolveCallerIdentity({
    callerId: "07825395792",
    analysis: { caller_name: "Luke", company: "Northwind Ltd" },
  });
  assertEquals(fromAnalysis.company, "Northwind Ltd");
  assertEquals(fromAnalysis.callerName, "Luke");
  assertEquals(
    formatCallerDisplay(fromAnalysis),
    "Luke (Northwind Ltd) · 07825395792",
  );

  const fromCollected = resolveCallerIdentity({
    callerId: "07825395792",
    collected: { name: "Sam", company_name: "Acme" },
  });
  assertEquals(fromCollected.company, "Acme");
  assertEquals(extractCompanyFromText("The company is Northwind Ltd"), "Northwind Ltd");
});
