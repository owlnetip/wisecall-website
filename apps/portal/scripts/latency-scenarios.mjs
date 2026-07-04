/** Pre-recorded caller prompt scenarios for latency testing. */

export type LatencyScenario = {
  id: string;
  label: string;
  prompts: string[];
  /** Seconds to wait after each prompt for the agent to respond. */
  pauseAfterPromptSec: number;
};

export const LATENCY_SCENARIOS: Record<string, LatencyScenario> = {
  dental: {
    id: "dental",
    label: "Dental reception",
    prompts: [
      "Hi, are you open tomorrow?",
      "Can I book an appointment for Monday morning?",
      "Can you send me a text confirmation?",
      "Actually, can I change that to Tuesday?",
    ],
    pauseAfterPromptSec: 12,
  },
  generic: {
    id: "generic",
    label: "Generic business",
    prompts: [
      "Hello, what are your opening hours?",
      "I'd like to leave a message for the team.",
      "Can someone call me back this afternoon?",
    ],
    pauseAfterPromptSec: 10,
  },
};

export function getScenario(id: string): LatencyScenario {
  return LATENCY_SCENARIOS[id] || LATENCY_SCENARIOS.dental;
}

export function buildTwilioTwiml(scenario: LatencyScenario): string {
  const parts: string[] = ['<?xml version="1.0" encoding="UTF-8"?>', "<Response>", "<Record maxLength=\"300\" playBeep=\"false\" />"];

  for (const prompt of scenario.prompts) {
    const escaped = prompt
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    parts.push(`<Say voice="Polly.Amy" language="en-GB">${escaped}</Say>`);
    parts.push(`<Pause length="${scenario.pauseAfterPromptSec}" />`);
  }

  parts.push("<Pause length=\"3\" />");
  parts.push("</Response>");
  return parts.join("");
}
