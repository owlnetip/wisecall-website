import assert from "node:assert/strict";
import { test } from "node:test";
import {
  newIntegrationWebhook,
  mergeStoredWebhookTestEvidence,
  readIntegrationWebhooks,
  serializeIntegrationWebhooks,
  validateIntegrationWebhooks,
  webhookVerificationState,
} from "./integration-webhooks";

test("preserves explicit webhook test evidence through metadata serialization", () => {
  const testedAt = "2026-07-10T12:00:00.000Z";
  const [stored] = serializeIntegrationWebhooks([
    newIntegrationWebhook({
      id: "hook-1",
      friendlyName: "Update CRM",
      name: "update_crm",
      url: "https://api.example.org/wisecall",
      lastTestedAt: testedAt,
      lastTestOk: true,
      lastTestStatus: 204,
    }),
  ]);
  const [read] = readIntegrationWebhooks({ integration_webhooks: [stored] });

  assert.equal(read.lastTestedAt, testedAt);
  assert.equal(read.lastTestOk, true);
  assert.equal(read.lastTestStatus, 204);
  assert.equal(webhookVerificationState(read), "passing");
});

test("distinguishes disabled, untested and failing webhook states", () => {
  assert.equal(webhookVerificationState(newIntegrationWebhook({ enabled: false })), "disabled");
  assert.equal(webhookVerificationState(newIntegrationWebhook()), "untested");
  assert.equal(
    webhookVerificationState(
      newIntegrationWebhook({
        lastTestedAt: "2026-07-10T12:00:00.000Z",
        lastTestOk: false,
      }),
    ),
    "failing",
  );
});

test("only preserves server-stored test evidence while execution settings are unchanged", () => {
  const stored = newIntegrationWebhook({
    id: "hook-1",
    name: "update_crm",
    url: "https://api.example.org/one",
    lastTestedAt: "2026-07-10T12:00:00.000Z",
    lastTestOk: true,
  });
  const [unchanged] = mergeStoredWebhookTestEvidence(
    [{ ...stored, lastTestOk: false, lastTestError: "forged" }],
    [stored],
  );
  const [changed] = mergeStoredWebhookTestEvidence(
    [{ ...stored, url: "https://api.example.org/two" }],
    [stored],
  );

  assert.equal(unchanged.lastTestOk, true);
  assert.equal(unchanged.lastTestError, undefined);
  assert.equal(changed.lastTestedAt, undefined);
  assert.equal(changed.lastTestOk, undefined);
});

test("rejects incomplete, duplicate and unsafe enabled webhook configuration", () => {
  const first = newIntegrationWebhook({
    friendlyName: "CRM lookup",
    name: "crm_lookup",
    url: "https://api.example.org/lookup",
  });
  assert.match(validateIntegrationWebhooks([newIntegrationWebhook({ url: "" })]) ?? "", /endpoint URL/);
  assert.match(
    validateIntegrationWebhooks([first, { ...first, id: "hook-2" }]) ?? "",
    /unique tool name/,
  );
  assert.match(
    validateIntegrationWebhooks([
      { ...first, headers: [{ key: "Host", value: "internal" }] },
    ]) ?? "",
    /cannot set the Host header/,
  );
});
