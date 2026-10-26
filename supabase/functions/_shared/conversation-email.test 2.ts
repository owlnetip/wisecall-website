import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  outcomeLabel,
  postCallEmailSubject,
} from "./conversation-email.ts";

Deno.test("does not invent next actions when analysis stored none", () => {
  assertEquals(nextActionsFromAnalysisJson({ action_items: [] }), []);
  assertEquals(nextActionsFromAnalysisJson(null), []);
});

Deno.test("post-call html matches portal follow-up wording", () => {
  const html = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "07825395792",
    summary: "Caller Luke asked for a callback about broadband.",
    transcript: "user: please call me back",
    outcome: "Caller ended",
    actionItems: ["Call Luke back about broadband"],
    agentName: "Mia",
  });
  if (!html.includes("Follow-up needed")) throw new Error("missing Follow-up needed");
  if (!html.includes("Call Luke back about broadband")) throw new Error("missing action item");
  if (!html.includes("What happened")) throw new Error("missing What happened");
  assertEquals(nextStepLabel(["Call Luke back about broadband"]), "1 follow-up needed");
});

Deno.test("urgent or promised callback cannot render no follow-up", () => {
  const urgent = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Priority: Urgent. Locked out of the login system.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
  });
  if (urgent.includes("No follow-up needed")) throw new Error("urgent call hid the follow-up");
  if (!urgent.includes("1 follow-up needed")) throw new Error("urgent call missing follow-up label");

  const callback = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Callback promised as soon as possible.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
    urgency: "low",
  });
  if (callback.includes("No follow-up needed")) throw new Error("callback hid the follow-up");

  const resolved = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Opening hours, resolved.",
    transcript: "Agent: Is that the best number to call you back on?",
    outcome: "Completed",
    actionItems: [],
  });
  if (!resolved.includes("No follow-up needed")) throw new Error("resolved call should need nothing");
});

Deno.test("never leaks a runtime state name into a customer's inbox", () => {
  assertEquals(outcomeLabel("bridge_closed"), "Call ended");
  assertEquals(outcomeLabel("deepgram_closed"), "Call ended");
  assertEquals(outcomeLabel("caller_stop"), "Caller ended the call");
  assertEquals(outcomeLabel("transfer_to_mobile_completed"), "Transferred to the team");
  assertEquals(outcomeLabel("sms_sent"), "Information sent by SMS");
  assertEquals(outcomeLabel(""), "Conversation recorded");
  assertEquals(outcomeLabel("Message taken for Matt Savage"), "Message taken for Matt Savage");
  assertEquals(outcomeLabel("SMS replied"), "SMS replied");
  assertEquals(outcomeLabel("media_socket_reset"), "Media socket reset");
});

Deno.test("claude note, callback number and emergency priority stay on the email", () => {
  const input = {
    businessName: "Excel Telecom",
    callerId: "+441482690288",
    callerName: "Alana Shaw",
    company: "Harbour and Co",
    companyStatus: "unconfirmed",
    callbackNumber: "07967161428",
    summary: "Alana Shaw from Harbour and Co needs someone to call her back about a burst pipe.",
    transcript: "user: my number is oh seven nine six seven one six one four two eight",
    outcome: "caller_hangup",
    actionItems: [] as string[],
    urgency: "emergency",
    agentName: "Mia",
  };
  const html = buildPostCallEmailHtml(input);
  const text = buildPostCallEmailText(input);
  if (!html.includes("What happened")) throw new Error("missing Claude note heading");
  if (!html.includes("Alana Shaw from Harbour and Co needs someone to call her back")) {
    throw new Error("missing Claude note");
  }
  if (!text.includes("What happened: Alana Shaw from Harbour and Co")) {
    throw new Error("missing Claude note in text");
  }
  if (!html.includes("Call back")) throw new Error("missing callback row");
  if (!html.includes("07967161428")) throw new Error("missing spoken callback number");
  if (!html.includes("Calling line")) throw new Error("missing calling line");
  if (!html.includes("+441482690288")) throw new Error("missing calling line number");
  if (!html.includes("Emergency")) throw new Error("missing emergency priority");
  if (!html.includes("Harbour and Co (not confirmed)")) throw new Error("missing unconfirmed company");
  if (html.includes("No follow-up needed")) throw new Error("emergency call hid the follow-up");
  if (!html.includes("1 follow-up needed")) throw new Error("emergency call missing follow-up");
  if (!html.includes("Caller ended the call")) throw new Error("outcome label missing");
  assertEquals(
    postCallEmailSubject(input),
    "EMERGENCY · Follow-up needed · Alana Shaw · Excel Telecom",
  );
});

Deno.test("unconfirmed company is marked and a confirmed one is not", () => {
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
  if (!unconfirmed.includes("Harbour and Co (not confirmed)")) {
    throw new Error("unconfirmed company was not marked");
  }

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
  if (!confirmed.includes("Company: Northwind Digital")) throw new Error(confirmed);
  if (confirmed.includes("not confirmed")) throw new Error(confirmed);

  const none = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Personal call about opening hours, resolved on the call.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
    company: "",
    companyStatus: "none",
  });
  if (!none.includes("No company")) throw new Error("missing No company");
});

Deno.test("caller row prefers the spelled name over a merged model guess", () => {
  const transcript = [
    "Agent: Who am I speaking with?",
    "Caller: Zamia Khan and Jamal Rashid also needs access.",
    "Agent: Could you spell your name?",
    "Caller: Z-A-M-I-A K-H-A-N",
  ].join("\n");
  const html = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "+441482690288",
    callerName: "Zamia Khan Jamal Rashid",
    summary: "Caller asked about access.",
    transcript,
    outcome: "Completed",
    actionItems: ["Call them back"],
  });
  if (!html.includes(">Zamia Khan<")) throw new Error("spelled name missing");
  if (html.includes("Zamia Khan Jamal Rashid")) throw new Error("merged name leaked");
});

Deno.test("omits the follow-up list when none exist", () => {
  const html = buildPostCallEmailHtml({
    businessName: "Excel Telecom",
    callerId: "Unknown",
    summary: "Opening hours, resolved.",
    transcript: "",
    outcome: "Completed",
    actionItems: [],
  });
  if (!html.includes("No follow-up needed")) throw new Error("missing none label");
  if (html.includes("<ul")) throw new Error("should omit follow-up list");
});
