import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCallSummaryHtml,
  callSummaryRecipients,
  mergeNotificationEmails,
  uniqueEmails,
} from "./call-summary-email";

test("uses the portal default routing inbox for a taken message", () => {
  assert.deepEqual(
    callSummaryRecipients({
      default_routing_email: "ops@excel-telecom.test",
    }),
    ["ops@excel-telecom.test"],
  );
});

test("reads legacy notification_emails and fallback_email", () => {
  assert.deepEqual(
    callSummaryRecipients({
      notification_emails: ["one@test.com", "one@test.com"],
      fallback_email: "two@test.com",
    }),
    ["one@test.com", "two@test.com"],
  );
});

test("emails a keyword-matched notify contact as well as the default inbox", () => {
  assert.deepEqual(
    callSummaryRecipients(
      {
        default_routing_email: "inbox@test.com",
        routing_contacts: [
          {
            id: "accounts",
            name: "Accounts",
            email: "accounts@test.com",
            notify: true,
          },
        ],
      },
      { route_key: "accounts", label: "Accounts" },
    ),
    ["inbox@test.com", "accounts@test.com"],
  );
});

test("falls back to Email summary contacts when no default inbox is set", () => {
  assert.deepEqual(
    callSummaryRecipients({
      routing_contacts: [
        {
          id: "c1",
          name: "Sam",
          email: "sam@test.com",
          notify: true,
        },
        {
          id: "c2",
          name: "Alex",
          email: "alex@test.com",
          notify: false,
        },
      ],
    }),
    ["sam@test.com"],
  );
});

test("useDefaultEmail contacts reuse the pooled inbox", () => {
  assert.deepEqual(
    callSummaryRecipients({
      default_routing_email: "pooled@test.com",
      routing_contacts: [
        {
          id: "c1",
          name: "Duty manager",
          notify: true,
          useDefaultEmail: true,
          email: "",
        },
      ],
    }),
    ["pooled@test.com"],
  );
});

test("does not invent an owlnet fallback when the customer configured nothing", () => {
  assert.deepEqual(callSummaryRecipients({}), []);
});

test("drops invalid addresses", () => {
  assert.deepEqual(uniqueEmails(["not-an-email", "ok@test.com", ""]), ["ok@test.com"]);
});

test("keeps extra notification_emails when the default inbox is changed", () => {
  assert.deepEqual(
    mergeNotificationEmails("old@test.com", "new@test.com", [
      "old@test.com",
      "bcc@test.com",
    ]),
    ["new@test.com", "bcc@test.com"],
  );
});

test("summary html includes the caller and the message", () => {
  const html = buildCallSummaryHtml({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Caller Luke asked for a callback about broadband.",
    transcript: "user: please call me back",
    outcome: "remote_hangup",
    startedAt: "2026-08-24T14:47:00.000Z",
  });
  assert.match(html, /Excel Telecom/);
  assert.match(html, /07825395792/);
  assert.match(html, /please call me back/);
  assert.match(html, /Caller Luke asked for a callback/);
});
