import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  extractLeadgenChanges,
  extractUkMobileFromFieldData,
  fetchGraphLead,
  graphLeadUrl,
  META_GRAPH_API_VERSION,
  META_LEADGEN_SOURCE,
  metaHubChallengeResponse,
  metaLeadRateLimitIp,
  verifyMetaSignature,
} from "./meta-leadgen";

const leadgenPayload = {
  object: "page",
  entry: [
    {
      id: "PAGE_1",
      time: 1_700_000_000,
      changes: [
        {
          field: "feed",
          value: { item: "status" },
        },
        {
          field: "leadgen",
          value: {
            leadgen_id: "LEAD_1",
            page_id: "PAGE_1",
            form_id: "FORM_1",
          },
        },
        {
          field: "leadgen",
          value: {
            leadgen_id: "LEAD_1",
            page_id: "PAGE_1",
            form_id: "FORM_1",
          },
        },
      ],
    },
  ],
};

test("Instant Form source is the existing Ava demo path, not a new wizard", () => {
  assert.equal(META_LEADGEN_SOURCE, "facebook_instant_form");
});

test("echoes hub.challenge only when mode and verify token match", () => {
  const params = new URLSearchParams({
    "hub.mode": "subscribe",
    "hub.verify_token": "wisecall-meta-verify",
    "hub.challenge": "1158201444",
  });
  assert.equal(metaHubChallengeResponse(params, "wisecall-meta-verify"), "1158201444");
  assert.equal(metaHubChallengeResponse(params, "wrong-token"), null);
  assert.equal(
    metaHubChallengeResponse(new URLSearchParams({ "hub.mode": "subscribe" }), "wisecall-meta-verify"),
    null,
  );
});

test("extracts unique leadgen changes and ignores other Page fields", () => {
  assert.deepEqual(extractLeadgenChanges(leadgenPayload), [
    { leadgenId: "LEAD_1", pageId: "PAGE_1", formId: "FORM_1" },
  ]);
  assert.deepEqual(extractLeadgenChanges({ object: "page", entry: [] }), []);
  assert.deepEqual(extractLeadgenChanges(null), []);
});

test("extracts a UK mobile from Instant Form field_data and rejects non-UK", () => {
  assert.equal(
    extractUkMobileFromFieldData([
      { name: "full_name", values: ["Ada Lovelace"] },
      { name: "phone_number", values: ["07700 900123"] },
    ]),
    "+447700900123",
  );
  assert.equal(
    extractUkMobileFromFieldData([{ name: "Your mobile", values: ["+44 7700 900123"] }]),
    "+447700900123",
  );
  assert.equal(
    extractUkMobileFromFieldData([{ name: "notes", values: ["07700 900123"] }]),
    "+447700900123",
  );
  assert.equal(
    extractUkMobileFromFieldData([
      { name: "phone_number", values: ["+1 415 555 2671"] },
      { name: "full_name", values: ["Ada"] },
    ]),
    null,
  );
  assert.equal(
    extractUkMobileFromFieldData([{ name: "phone_number", values: ["0113 522 2277"] }]),
    null,
  );
  assert.equal(extractUkMobileFromFieldData([]), null);
});

test("verifies X-Hub-Signature-256 when an app secret is set", () => {
  const body = JSON.stringify(leadgenPayload);
  const digest = createHmac("sha256", "app-secret").update(body).digest("hex");
  assert.equal(verifyMetaSignature(body, `sha256=${digest}`, "app-secret"), true);
  assert.equal(verifyMetaSignature(body, `sha256=${digest}`, "other-secret"), false);
  assert.equal(verifyMetaSignature(body, null, ""), true);
  assert.equal(verifyMetaSignature(body, "sha256=deadbeef", "app-secret"), false);
});

test("Graph lead URL stays on graph.facebook.com and does not embed the token", () => {
  const url = graphLeadUrl("LEAD_1", META_GRAPH_API_VERSION);
  assert.equal(url, "https://graph.facebook.com/v25.0/LEAD_1?fields=id,created_time,field_data");
  assert.equal(url.includes("access_token"), false);
});

test("page-scoped Meta rate-limit identity does not use a Facebook egress IP", () => {
  assert.equal(metaLeadRateLimitIp("PAGE_1"), "meta-leadgen:PAGE_1");
  assert.equal(metaLeadRateLimitIp(""), "meta-leadgen:unknown-page");
});

test("fetchGraphLead sends the page token as Bearer and returns field_data", async () => {
  const lead = {
    id: "LEAD_1",
    field_data: [{ name: "phone_number", values: ["07700900123"] }],
  };
  const result = await fetchGraphLead("LEAD_1", "page-token", async (input, init) => {
    assert.equal(String(input), graphLeadUrl("LEAD_1"));
    assert.equal((init as RequestInit).method, "GET");
    const headers = new Headers((init as RequestInit).headers);
    assert.equal(headers.get("Authorization"), "Bearer page-token");
    return new Response(JSON.stringify(lead), { status: 200 });
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.lead.id, "LEAD_1");
    assert.equal(extractUkMobileFromFieldData(result.lead.field_data), "+447700900123");
  }
});

test("fetchGraphLead fails closed when the page token is missing", async () => {
  const result = await fetchGraphLead("LEAD_1", "", async () => {
    throw new Error("should not call Graph");
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 503);
    assert.match(result.error, /META_PAGE_ACCESS_TOKEN/);
  }
});
