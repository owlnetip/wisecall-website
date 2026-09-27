import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  portalNextActions,
} from "./conversation-email";

test("reads action_items the same way the portal inbox does", () => {
  assert.deepEqual(
    nextActionsFromAnalysisJson({
      action_items: ["Call Luke back about broadband", "Email the quote", ""],
      recommended_follow_up: "ignored when the list is present",
    }),
    ["Call Luke back about broadband", "Email the quote"],
  );
});

test("falls back to recommended_follow_up when action_items is missing", () => {
  assert.deepEqual(
    nextActionsFromAnalysisJson({
      recommended_follow_up: "Book an emergency slot",
    }),
    ["Book an emergency slot"],
  );
});

test("does not invent next actions when analysis stored none", () => {
  assert.deepEqual(nextActionsFromAnalysisJson({ action_items: [] }), []);
  assert.deepEqual(nextActionsFromAnalysisJson({}), []);
  assert.deepEqual(nextActionsFromAnalysisJson(null), []);
});

test("portal next actions prefer analysis over follow-up titles", () => {
  assert.deepEqual(
    portalNextActions({
      analysisJson: { action_items: ["Call back re refund"] },
      followUpTitles: ["Stale title"],
    }),
    ["Call back re refund"],
  );
  assert.deepEqual(
    portalNextActions({
      analysisJson: { action_items: [] },
      followUpTitles: ["Call the vendor"],
    }),
    ["Call the vendor"],
  );
});

test("inbox next step cannot say none when the call was urgent or a callback was promised", () => {
  assert.equal(
    nextStepLabel(
      portalNextActions({
        analysisJson: {
          action_items: [],
          urgency_level: "high",
          short_manager_summary: "Locked out of the login system. Blocking all access.",
        },
      }),
    ),
    "1 follow-up needed",
  );
  assert.equal(
    nextStepLabel(
      portalNextActions({
        analysisJson: { action_items: [], urgency_level: "low" },
        summary: "Callback promised as soon as possible.",
      }),
    ),
    "1 follow-up needed",
  );
  assert.equal(
    nextStepLabel(
      portalNextActions({
        analysisJson: { action_items: [], urgency_level: "low" },
        summary: "Asked what time you open. Resolved on the call.",
      }),
    ),
    "No follow-up needed",
  );
});

test("next step label matches the inbox wording", () => {
  assert.equal(nextStepLabel([]), "No follow-up needed");
  assert.equal(nextStepLabel(["Call back"]), "1 follow-up needed");
  assert.equal(nextStepLabel(["Call back", "Send quote"]), "2 follow-ups needed");
});

test("summary html includes follow-ups with the portal headings", () => {
  const html = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Caller Luke asked for a callback about broadband.",
    transcript: "user: please call me back",
    outcome: "Caller ended",
    startedAt: "2026-08-24T14:47:00.000Z",
    actionItems: ["Call Luke back about broadband"],
    agentName: "Mia",
  });
  assert.match(html, /Excel Telecom/);
  assert.match(html, /07825395792/);
  assert.match(html, /Next step/);
  assert.match(html, /1 follow-up needed/);
  assert.match(html, /Follow-up needed/);
  assert.match(html, /Call Luke back about broadband/);
  assert.match(html, /What happened/);
  assert.match(html, /Caller Luke asked for a callback/);
  assert.match(html, /please call me back/);
  assert.match(html, /Conversation transcript/);
});

test("omits the follow-up list when none exist and says none", () => {
  const html = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Opening hours question, resolved on the call.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
  });
  assert.match(html, /No follow-up needed/);
  assert.equal(html.includes("Follow-up needed"), false);
  assert.equal(html.includes("<ul"), false);
});

test("company confidence is visible in the summary email", () => {
  const unconfirmed = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Login lockout.",
    transcript: "user: Harbour and Co",
    outcome: "Completed",
    actionItems: [],
    company: "Harbour and Co",
    companyStatus: "unconfirmed",
  });
  assert.match(unconfirmed, /Caller Company/);
  assert.match(unconfirmed, /Harbour and Co \(not confirmed\)/);

  const confirmed = buildPostCallEmailText({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Login lockout.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
    company: "Northwind Digital",
    companyStatus: "confirmed",
  });
  assert.match(confirmed, /Caller Company: Northwind Digital/);
  assert.equal(confirmed.includes("not confirmed"), false);

  const legacy = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Opening hours.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
    company: "Acme Ltd",
  });
  assert.match(legacy, /Acme Ltd \(not confirmed\)/);

  const empty = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Opening hours question, resolved on the call.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
  });
  assert.equal(empty.includes("Caller Company"), false);
  assert.equal(empty.includes("Company not confirmed"), false);
});

test("plain-text email includes the same next actions", () => {
  const text = buildPostCallEmailText({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Callback requested.",
    transcript: "user: call me",
    outcome: "Completed",
    actionItems: ["Call Luke back about broadband"],
  });
  assert.match(text, /Next step: 1 follow-up needed/);
  assert.match(text, /Follow-up needed:/);
  assert.match(text, /- Call Luke back about broadband/);
  assert.match(text, /What happened: Callback requested/);
});
