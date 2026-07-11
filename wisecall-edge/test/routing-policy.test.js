const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildRoutingPolicyBlock,
  buildRoutingPolicySection,
  readCallScreening,
  normaliseTransferMode,
  DEFAULT_CALL_SCREENING,
} = require("../src/lib/routingPolicy");
const { buildSystemPrompt } = require("../src/prompt");

test("normaliseTransferMode falls back to confirm_caller", () => {
  assert.equal(normaliseTransferMode("immediate"), "immediate");
  assert.equal(normaliseTransferMode("ask_client"), "ask_client");
  assert.equal(normaliseTransferMode("nope"), "confirm_caller");
});

test("readCallScreening uses defaults when missing", () => {
  assert.deepEqual(readCallScreening({}), DEFAULT_CALL_SCREENING);
  assert.equal(
    readCallScreening({ call_screening: { salesPolicy: "politely_decline" } })
      .salesPolicy,
    "politely_decline",
  );
});

test("buildRoutingPolicyBlock covers sales, spam, and named-person modes", () => {
  const block = buildRoutingPolicyBlock({
    screening: {
      salesPolicy: "field",
      spamPolicy: "politely_end",
      namedPersonPolicy: "ask_client",
    },
    contacts: [
      {
        name: "Sarah",
        transfer: true,
        transferMode: "immediate",
        keywords: ["sarah", "manager"],
      },
      {
        name: "Accounts",
        transfer: true,
        transferMode: "ask_client",
        keywords: ["invoice"],
      },
      {
        name: "Sales inbox",
        transfer: false,
        transferMode: "message_only",
        keywords: ["vendor"],
      },
    ],
  });

  assert.match(block, /\[CALL ROUTING & SCREENING\]/);
  assert.match(block, /Sarah.*put them through straight away/i);
  assert.match(block, /Accounts.*check if Accounts is available/i);
  assert.match(block, /Sales inbox.*message \/ notify only/i);
  assert.match(block, /field the call yourself/i);
  assert.match(block, /Never transfer spam/i);
});

test("buildSystemPrompt injects routing policy after caller intake", () => {
  const prompt = buildSystemPrompt(
    {
      system_prompt: "You are the receptionist.",
      metadata: {
        caller_intake_enabled: false,
        call_screening: {
          salesPolicy: "politely_decline",
          spamPolicy: "block",
          namedPersonPolicy: "immediate",
        },
        routing_contacts: [
          { name: "Ben", transfer: true, transferMode: "immediate", keywords: ["ben"] },
        ],
      },
    },
    { contactBlock: "[CALLER MEMORY]\nName: Sam" },
  );

  assert.match(prompt, /\[CALLER MEMORY\]/);
  assert.match(prompt, /\[CALL ROUTING & SCREENING\]/);
  assert.match(prompt, /politely decline/i);
  assert.match(prompt, /Ben.*straight away/i);
  assert.match(prompt, /You are the receptionist\./);
  assert.ok(prompt.indexOf("[CALL ROUTING & SCREENING]") < prompt.indexOf("You are the receptionist."));
});

test("buildRoutingPolicySection reads metadata contacts", () => {
  const section = buildRoutingPolicySection({
    call_screening: { namedPersonPolicy: "message_only" },
    routing_contacts: [{ name: "Owner", transferMode: "ask_client", transfer: true }],
  });
  assert.match(section, /Owner.*check if Owner is available/i);
  assert.match(section, /message only/i);
});
