import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostCallEmailHtml,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  outcomeLabel,
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

Deno.test("never leaks a runtime state name into a customer's inbox", () => {
  assertEquals(outcomeLabel("bridge_closed"), "Call ended");
  assertEquals(outcomeLabel("deepgram_closed"), "Call ended");
  assertEquals(outcomeLabel("caller_stop"), "Caller ended the call");
  assertEquals(outcomeLabel("transfer_to_mobile_completed"), "Transferred to the team");
  assertEquals(outcomeLabel("sms_sent"), "Information sent by SMS");
  assertEquals(outcomeLabel(""), "Conversation recorded");
  // Prose the model wrote is already readable and passes through.
  assertEquals(outcomeLabel("Message taken for Matt Savage"), "Message taken for Matt Savage");
  assertEquals(outcomeLabel("SMS replied"), "SMS replied");
  // An outcome we have never seen still must not arrive as snake_case.
  assertEquals(outcomeLabel("media_socket_reset"), "Media socket reset");
});
