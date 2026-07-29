// Builds the system prompt the LLM receives. Mirrors prompt.js on the live server.

const { buildCallerIntakeSection } = require("./lib/callerIntake");

function buildSystemPrompt(profile, { contactBlock, integrationBlock, callerId } = {}) {
  const parts = [];
  const metadata = profile.metadata || {};

  if (integrationBlock) parts.push(integrationBlock);
  if (contactBlock) parts.push(contactBlock);

  const intake = buildCallerIntakeSection({ callerId, metadata });
  if (intake) parts.push(intake);

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

  // Estate Digital Negotiator rules (tone, qualification gates, escalate keywords).
  // Stored as metadata.negotiator_rules; also baked into estate system prompts at create time.
  const negotiatorRules = profile.metadata?.negotiator_rules;
  if (negotiatorRules && typeof negotiatorRules === "object") {
    const lines = ["[DIGITAL NEGOTIATOR RULES — follow these exactly]"];
    if (negotiatorRules.tone) lines.push(`Tone: ${negotiatorRules.tone}`);
    if (negotiatorRules.brandNotes) lines.push(`Brand notes: ${negotiatorRules.brandNotes}`);
    if (negotiatorRules.qualificationRequired !== false) {
      const fields = Array.isArray(negotiatorRules.requiredFields)
        ? negotiatorRules.requiredFields.join(", ")
        : "name, phone, budget, area, beds, timeline";
      lines.push(`Qualification: required before booking. Capture: ${fields}.`);
    }
    if (negotiatorRules.bookViewingWhenQualified !== false) {
      lines.push(
        "When qualified for a viewing, call request_viewing (do not invent owner numbers).",
      );
    }
    if (negotiatorRules.alwaysAskVendorOpportunity !== false) {
      lines.push(
        "Vendor opportunity: if the caller is a buyer/tenant, briefly ask whether they also have a property to sell or let.",
      );
    }
    if (negotiatorRules.outOfHoursMode) {
      lines.push(`Out-of-hours mode: ${negotiatorRules.outOfHoursMode}.`);
    }
    if (Array.isArray(negotiatorRules.escalateKeywords) && negotiatorRules.escalateKeywords.length) {
      lines.push(
        `Escalate / hand to human negotiator (do not price-negotiate) when mentioned: ${negotiatorRules.escalateKeywords.join(", ")}.`,
      );
    }
    if (Array.isArray(negotiatorRules.neverSay) && negotiatorRules.neverSay.length) {
      lines.push(
        `Never say: ${negotiatorRules.neverSay.map((s) => `"${s}"`).join("; ")}.`,
      );
    }
    if (negotiatorRules.handoffMessage) {
      lines.push(`Handoff line: ${negotiatorRules.handoffMessage}`);
    }
    lines.push(
      "After capturing qualification, call the log_enquiry tool so the branch sees it in Monday's results.",
    );
    parts.push(lines.join("\n"));
  }

  return parts.filter(Boolean).join("\n\n");
}

module.exports = { buildSystemPrompt };
