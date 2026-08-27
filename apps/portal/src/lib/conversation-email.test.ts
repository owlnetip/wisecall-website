import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  callerNameFromSources,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  parseEmailTranscript,
  portalNextActions,
  postCallEmailSubject,
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
  assert.match(html, /Conversation/);
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

test("shows the caller name at the top and keeps the number", () => {
  const html = buildPostCallEmailHtml({
    businessName: "The Home Cloud",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "Caller Luke reported a repair.",
    transcript: "user: I'm looking to report a repair",
    outcome: "remote_hangup",
    actionItems: [],
  });
  assert.match(html, /New message from Luke/);
  assert.match(html, />Caller<\/td><td[^>]*>Luke/);
  assert.match(html, />Number<\/td><td>07825395792/);
  assert.match(html, /Caller ended/);
  assert.match(html, /Wise<\/span><span[^>]*>Call/);
  assert.equal(postCallEmailSubject({
    businessName: "The Home Cloud",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "",
    transcript: "",
    outcome: "",
    actionItems: [],
  }), "Message from Luke · The Home Cloud");
});

test("parses branded transcript bubbles and drops tool-call dumps", () => {
  const turns = parseEmailTranscript(`assistant: Hi, thanks for calling.
user: Home cloud.
[function_response] send_information_sms {"ok":true,"status":"sent"}
[function_request] send_information_sms {"link_type":"repair"}
assistant: I have texted the repair link.`);
  assert.deepEqual(turns, [
    { speaker: "agent", text: "Hi, thanks for calling." },
    { speaker: "caller", text: "Home cloud." },
    { speaker: "agent", text: "I have texted the repair link." },
  ]);

  const html = buildPostCallEmailHtml({
    businessName: "The Home Cloud",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "Repair reported.",
    transcript: "assistant: Please visit thehomecloud.co.uk\nuser: That's it. Thanks.\n[function_response] send_information_sms {\"ok\":true}",
    outcome: "Completed",
    actionItems: [],
  });
  assert.match(html, />Luke</);
  assert.match(html, /Please visit thehomecloud.co.uk/);
  assert.match(html, /That&#39;s it. Thanks./);
  assert.equal(html.includes("function_response"), false);
  assert.equal(html.includes("send_information_sms"), false);
});

test("resolves caller name from analysis, then captured-name summary", () => {
  assert.equal(
    callerNameFromSources({
      analysisJson: { caller_name: "Luke" },
      summary: "Caller Loop said: looking to report a repair.",
    }),
    "Luke",
  );
  assert.equal(
    callerNameFromSources({
      summary: "Caller Luke said: Looking to report a repair. Captured name Luke, phone 07825395792.",
    }),
    "Luke",
  );
  assert.equal(callerNameFromSources({ summary: "Opening hours question." }), "");
});
