import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostCallEmailHtml,
  nextActionsFromAnalysisJson,
  nextStepLabel,
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
