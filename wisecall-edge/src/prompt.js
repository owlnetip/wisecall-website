// Builds the system prompt the LLM receives. Mirrors prompt.js on the live server.

const { buildCallerIntakeSection } = require("./lib/callerIntake");
const { buildRoutingPolicySection } = require("./lib/routingPolicy");

function buildSystemPrompt(profile, { contactBlock, integrationBlock, callerId } = {}) {
  const parts = [];
  const metadata = profile.metadata || {};

  if (integrationBlock) parts.push(integrationBlock);
  if (contactBlock) parts.push(contactBlock);

  const intake = buildCallerIntakeSection({ callerId, metadata });
  if (intake) parts.push(intake);

  const routingPolicy = buildRoutingPolicySection(metadata);
  if (routingPolicy) parts.push(routingPolicy);

  if (profile.system_prompt) parts.push(profile.system_prompt);

  const knowledge = profile.business_context || profile.metadata?.knowledge;
  if (knowledge) {
    parts.push(`[BUSINESS KNOWLEDGE]\n${knowledge}`);
  }

  const officeHours = profile.metadata?.office_hours;
  if (officeHours && typeof officeHours === "object" && Object.keys(officeHours).length) {
    const lines = ["[OFFICE HOURS]"];
    for (const [day, hours] of Object.entries(officeHours)) {
      if (hours?.open && hours?.close) {
        lines.push(`${day}: ${hours.open}–${hours.close}`);
      }
    }
    parts.push(lines.join("\n"));
  }

  return parts.filter(Boolean).join("\n\n");
}

module.exports = { buildSystemPrompt };
