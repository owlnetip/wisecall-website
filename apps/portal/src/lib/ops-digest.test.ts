import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildDigestHtml,
  readOpsDigestSettings,
  shouldSendDigestSlot,
} from "@/lib/ops-digest";

describe("readOpsDigestSettings", () => {
  it("defaults to enabled morning and afternoon", () => {
    const settings = readOpsDigestSettings({});
    assert.equal(settings.enabled, true);
    assert.equal(settings.morning, true);
    assert.equal(settings.afternoon, true);
    assert.equal(settings.morningHour, 8);
    assert.equal(settings.afternoonHour, 15);
  });
});

describe("shouldSendDigestSlot", () => {
  it("matches configured local hour", () => {
    const settings = readOpsDigestSettings({});
    assert.equal(shouldSendDigestSlot(settings, "morning", 8), true);
    assert.equal(shouldSendDigestSlot(settings, "morning", 9), false);
    assert.equal(shouldSendDigestSlot(settings, "afternoon", 15), true);
  });
});

describe("buildDigestHtml", () => {
  it("puts do-first items ahead of still-open", () => {
    const content = buildDigestHtml({
      businessName: "Northline",
      slot: "morning",
      portalUrl: "https://app.wisecall.io/dashboard",
      items: [
        {
          id: "1",
          title: "Send brochure",
          caller: "+44111",
          priority: "low",
          category: "admin",
          dueAt: null,
          description: "",
        },
        {
          id: "2",
          title: "Hot lead callback",
          caller: "+44222",
          priority: "high",
          category: "lead",
          dueAt: null,
          description: "Wants a quote",
        },
        {
          id: "3",
          title: "Complaint follow-up",
          caller: "+44333",
          priority: "critical",
          category: "complaint",
          dueAt: null,
          description: "",
        },
      ],
    });
    assert.match(content.subject, /Morning overview/);
    assert.match(content.html, /Do first/);
    const firstIdx = content.html.indexOf("Complaint follow-up");
    const leadIdx = content.html.indexOf("Hot lead callback");
    const adminIdx = content.html.indexOf("Send brochure");
    assert.ok(firstIdx > -1 && leadIdx > -1 && adminIdx > -1);
    assert.ok(firstIdx < leadIdx);
    assert.ok(leadIdx < adminIdx);
  });
});
