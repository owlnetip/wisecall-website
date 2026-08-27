import assert from "node:assert/strict";
import { test } from "node:test";
import {
  callSummaryRecipients,
  mergeNotificationEmails,
  primaryInboxEmail,
  uniqueEmails,
} from "./notification-recipients";

test("uses the portal default routing inbox for post-call email", () => {
  assert.deepEqual(
    callSummaryRecipients({ default_routing_email: "ops@home-cloud.test" }),
    ["ops@home-cloud.test"],
  );
});

test("keeps notification_emails in sync when the default inbox changes", () => {
  assert.deepEqual(
    mergeNotificationEmails("old@test.com", "new@test.com", ["old@test.com", "bcc@test.com"]),
    ["new@test.com", "bcc@test.com"],
  );
});

test("primary inbox prefers default_routing_email", () => {
  assert.equal(
    primaryInboxEmail({
      default_routing_email: "inbox@test.com",
      notification_emails: ["legacy@test.com"],
    }),
    "inbox@test.com",
  );
});

test("drops invalid addresses", () => {
  assert.deepEqual(uniqueEmails(["not-an-email", "ok@test.com"]), ["ok@test.com"]);
});
