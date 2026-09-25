import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  callerNameFromSources,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  parseEmailTranscript,
} from "./conversation-email.ts";

Deno.test("does not invent next actions when analysis stored none", () => {
  assertEquals(nextActionsFromAnalysisJson({ action_items: [] }), []);
  assertEquals(nextActionsFromAnalysisJson(null), []);
});

Deno.test("post-call html matches the branded WiseCall template", () => {
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
  if (!html.includes("WiseCall Summary")) throw new Error("missing WiseCall Summary");
  if (!html.includes("Call transcript")) throw new Error("missing Call transcript");
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

Deno.test("puts the caller name on the Home Cloud style card", () => {
  const html = buildPostCallEmailHtml({
    businessName: "The Home Cloud",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "Caller Luke reported a repair.",
    transcript: "user: repair",
    outcome: "remote_hangup",
    actionItems: [],
  });
  if (!html.includes("Caller Name")) throw new Error("missing caller name row");
  if (!html.includes("Luke")) throw new Error("missing caller name");
  if (html.includes("<h1")) throw new Error("should not use a large name heading");
  if (!html.includes("07825395792")) throw new Error("missing number");
  if (!html.includes("Caller ended")) throw new Error("missing friendly outcome");
  if (html.includes("New message for")) throw new Error("old template leaked");
});

Deno.test("drops tool-call dumps and thinking notes from the transcript", () => {
  const turns = parseEmailTranscript(
    [
      "assistant: Thanks for Calling Charles Garth Charted Surveyors . How can I help today ?",
      "user: Project managers, please.",
      "[system] SLOW_THINK_REQUEST: We have now waited 5 seconds for a think response.",
      "[function_response] send_information_sms {\"ok\":true}",
      "[system] SLOW_SPEAK_REQUEST: We have now waited 5 seconds for a speak response.",
    ].join("\n"),
  );
  assertEquals(turns, [
    {
      speaker: "agent",
      text: "Thanks for Calling Charles Garth Charted Surveyors . How can I help today ?",
    },
    { speaker: "caller", text: "Project managers, please." },
  ]);
  const html = buildPostCallEmailHtml({
    businessName: "Charles Garth",
    callerId: "01543411855",
    summary: "Caller asked for the project managers.",
    transcript: turns.map((turn) => `${turn.speaker === "agent" ? "assistant" : "user"}: ${turn.text}`).join("\n") +
      "\n[system] SLOW_SPEAK_REQUEST: We have now waited 10 seconds for a speak response.",
    outcome: "Call ended",
    actionItems: [],
  });
  if (html.includes("SLOW_SPEAK_REQUEST")) throw new Error("speak note leaked");
  if (html.includes("[system]")) throw new Error("system label leaked");
  if (!html.includes("Project managers, please.")) throw new Error("missing caller line");
  const text = buildPostCallEmailText({
    businessName: "Charles Garth",
    callerId: "01543411855",
    summary: "Caller asked for the project managers.",
    transcript: "[system] SLOW_THINK_REQUEST: waited",
    outcome: "Call ended",
    actionItems: [],
  });
  if (text.includes("SLOW_THINK_REQUEST")) throw new Error("thinking note leaked into text");
  assertEquals(callerNameFromSources({ analysisJson: { caller_name: "Luke" } }), "Luke");
});
