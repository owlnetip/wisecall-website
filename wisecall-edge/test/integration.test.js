const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  substituteTemplates,
  readWebhooks,
  buildDuringCallTools,
} = require("../src/lib/integrationWebhooks");
const { buildSystemPrompt } = require("../src/prompt");
const { mergeIntegrationTools } = require("../src/lib/callSession");
const {
  buildEmailSummaryPayload,
  getEmailSummaryUrl,
} = require("../src/lib/emailSummary");

test("substituteTemplates replaces call context tokens", () => {
  const out = substituteTemplates("caller={{caller_id}} id={{profile_id}}", {
    callerId: "+441234567890",
    profileId: "abc-123",
  });
  assert.equal(out, "caller=+441234567890 id=abc-123");
});

test("readWebhooks filters by condition and enabled flag", () => {
  const metadata = {
    integration_webhooks: [
      { name: "pre", condition: "before_call", url: "https://x.test/pre", enabled: true },
      { name: "off", condition: "before_call", url: "https://x.test/off", enabled: false },
      { name: "post", condition: "after_call", url: "https://x.test/post", enabled: true },
    ],
  };
  assert.equal(readWebhooks(metadata, "before_call").length, 1);
  assert.equal(readWebhooks(metadata, "after_call")[0].name, "post");
});

test("buildDuringCallTools produces OpenAI function schemas", () => {
  const metadata = {
    integration_webhooks: [
      {
        name: "create_ticket",
        friendlyName: "Create ticket",
        description: "Open a support ticket",
        condition: "during_call",
        method: "POST",
        url: "https://x.test/tickets",
        enabled: true,
        parameters: [{ key: "subject", value: "" }],
      },
    ],
  };
  const tools = buildDuringCallTools(metadata, {
    profileId: "p1",
    callId: "c1",
    callerId: "+44111",
  });
  assert.equal(tools.length, 1);
  assert.equal(tools[0].function.name, "create_ticket");
  assert.deepEqual(tools[0].function.parameters.required, ["subject"]);
});

test("buildSystemPrompt prepends integration and contact blocks", () => {
  const prompt = buildSystemPrompt(
    { system_prompt: "You are the receptionist." },
    {
      contactBlock: "[CALLER MEMORY]\nName: Sam",
      integrationBlock: "[INTEGRATION CONTEXT]\nlookup: found",
    },
  );
  assert.match(prompt, /^\[INTEGRATION CONTEXT\]/);
  assert.match(prompt, /\[CALLER MEMORY\]/);
  assert.match(prompt, /You are the receptionist\./);
});

test("mergeIntegrationTools avoids duplicate tool names", () => {
  const session = {
    integrationTools: [
      {
        type: "function",
        function: { name: "transfer_call", description: "webhook transfer" },
      },
      {
        type: "function",
        function: { name: "create_ticket", description: "webhook ticket" },
      },
    ],
  };
  const builtIn = [
    { type: "function", function: { name: "transfer_call", description: "builtin" } },
  ];
  const merged = mergeIntegrationTools(session, builtIn);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].function.name, "transfer_call");
  assert.equal(merged[1].function.name, "create_ticket");
});

test("getEmailSummaryUrl defaults to the Supabase edge function URL", () => {
  assert.equal(
    getEmailSummaryUrl({ SUPABASE_URL: "https://example.supabase.co/" }),
    "https://example.supabase.co/functions/v1/wisecall-email-summary",
  );
  assert.equal(
    getEmailSummaryUrl({ WISECALL_EMAIL_SUMMARY_URL: "https://hooks.test/email" }),
    "https://hooks.test/email",
  );
});

test("buildEmailSummaryPayload carries routing metadata for recipient selection", () => {
  const payload = buildEmailSummaryPayload(
    {
      id: "p1",
      slug: "charles-garth",
      profile_name: "Charles Garth Voice Desk",
      business_name: "Charles Garth",
      receptionist_name: "Mia",
    },
    { callId: "call-1", callerId: "+441234567890" },
    {
      summary: "Message taken for accounts.",
      transcript: "user: accounts please",
      outcome: "caller_stop",
      startedAt: "2026-06-22T00:00:00.000Z",
      finishedAt: "2026-06-22T00:01:00.000Z",
      metadata: {
        collected: {
          transfer_route_key: "accounts",
          transfer_label: "Accounts",
          called_number: "+441135220500",
        },
      },
    },
  );

  assert.equal(payload.profile.slug, "charles-garth");
  assert.equal(payload.session.collected.transfer_route_key, "accounts");
  assert.deepEqual(payload.extra.transfer, { route_key: "accounts", label: "Accounts" });
});

test("buildEmailSummaryPayload falls back to conversation history when transcript is empty", () => {
  const payload = buildEmailSummaryPayload(
    { id: "p1", slug: "agent" },
    { callId: "call-1", callerId: "+441234567890" },
    {
      summary: "Message taken.",
      transcript: "",
      metadata: {
        history: [
          { type: "conversation", role: "assistant", content: "How can I help?" },
          { type: "conversation", role: "user", content: "Please call me back." },
          { type: "function_request", role: "assistant", content: "ignored" },
        ],
      },
    },
  );

  assert.equal(
    payload.extra.transcript,
    "assistant: How can I help?\nuser: Please call me back.",
  );
});
