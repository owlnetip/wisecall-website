import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callSummaryRecipients } from "./notification-recipients.ts";

Deno.test("default routing inbox receives a taken message with no transfer", () => {
  assertEquals(
    callSummaryRecipients({
      default_routing_email: "ops@excel-telecom.test",
    }),
    ["ops@excel-telecom.test"],
  );
});

Deno.test("notify contacts are used when the default inbox is empty", () => {
  assertEquals(
    callSummaryRecipients({
      routing_contacts: [
        { id: "c1", name: "Sam", email: "sam@test.com", notify: true },
      ],
    }),
    ["sam@test.com"],
  );
});
