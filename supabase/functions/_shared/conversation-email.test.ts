import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildPostCallEmailHtml,
  callerNameFromSources,
  nextActionsFromAnalysisJson,
  nextStepLabel,
  parseEmailTranscript,
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

Deno.test("puts the caller name at the top", () => {
  const html = buildPostCallEmailHtml({
    businessName: "The Home Cloud",
    callerId: "07825395792",
    callerName: "Luke",
    summary: "Caller Luke reported a repair.",
    transcript: "user: repair",
    outcome: "remote_hangup",
    actionItems: [],
  });
  if (!html.includes("New message from Luke") && !html.includes(">Luke<")) throw new Error("missing name heading");
  if (!html.includes("07825395792")) throw new Error("missing number");
  if (!html.includes("Caller ended")) throw new Error("missing friendly outcome");
});

Deno.test("drops tool-call dumps from the branded transcript", () => {
  const turns = parseEmailTranscript(
    "assistant: Hi\nuser: Hello\n[function_response] send_information_sms {\"ok\":true}\nassistant: Done",
  );
  assertEquals(turns, [
    { speaker: "agent", text: "Hi" },
    { speaker: "caller", text: "Hello" },
    { speaker: "agent", text: "Done" },
  ]);
  assertEquals(callerNameFromSources({ analysisJson: { caller_name: "Luke" } }), "Luke");
});
