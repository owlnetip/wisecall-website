import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildStatusBlock, readStatusCheckSettings } from "@/lib/status-flags";

describe("readStatusCheckSettings", () => {
  it("defaults to disabled", () => {
    const settings = readStatusCheckSettings({});
    assert.equal(settings.enabled, false);
    assert.equal(settings.webhookUrl, "");
  });

  it("reads enabled webhook config", () => {
    const settings = readStatusCheckSettings({
      status_check: {
        enabled: true,
        webhook_url: "https://example.com/status",
        webhook_secret: "secret",
        timeout_ms: 1500,
      },
    });
    assert.equal(settings.enabled, true);
    assert.equal(settings.webhookUrl, "https://example.com/status");
    assert.equal(settings.timeoutMs, 1500);
  });
});

describe("buildStatusBlock", () => {
  it("returns null when empty", () => {
    assert.equal(buildStatusBlock([]), null);
  });

  it("includes policy guidance", () => {
    const block = buildStatusBlock([
      {
        flagKey: "overdue_45",
        label: "Overdue account",
        policy: "soft_block",
        agentMessage: "Please speak to accounts first.",
        transferRouteKey: "accounts",
        appliesWhen: ["orders", "support"],
        source: "manual",
      },
    ]);
    assert.ok(block);
    assert.match(block!, /CALLER STATUS FLAGS/);
    assert.match(block!, /soft_block/);
    assert.match(block!, /accounts/);
  });
});
