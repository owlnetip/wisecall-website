/** Pre-recorded caller prompt scenarios for latency testing via MOR/SIP. */

export const LATENCY_SCENARIOS = {
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

export function getScenario(id) {
  return LATENCY_SCENARIOS[id] || LATENCY_SCENARIOS.dental;
}
