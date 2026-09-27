// Standard caller-intake instructions, synced from apps/portal/src/lib/caller-intake.ts

function isCallerIntakeEnabled(metadata) {
  return metadata?.caller_intake_enabled !== false;
}

function buildCallerIdBlock(callerId) {
  const id = (callerId ?? "").trim();
  if (!id) return null;
  return [
    "[CALLER ID]",
    `Line number for this call: ${id}`,
    "Treat this as the default callback number. Ask the caller to confirm it is the best number to reach them, only collect a different number if they say no.",
  ].join("\n");
}

const CALLER_INTAKE_PROMPT = `[CALLER DETAILS: collect before messages, callbacks, or transfers]

You receive the caller's line number automatically (see CALLER ID above when present). Use it. Do not ask them to read that number out unless they want a different callback number.

Capture one caller: the person you are speaking with. Never join two people's names into one name.

1. NAME. If CALLER MEMORY does not already give their name, ask: "Who am I speaking with?"
   • Store a single caller's name only. If they mention several people, ask which name is theirs and keep only that one.
   • If the name is unusual, unclear, or you are not sure you heard it, ask them to spell it, then read the spelling back.

2. COMPANY (when relevant). For business or trade enquiries ask: "Which company are you calling from?" Skip this for obvious personal calls.
   • If the company name is unusual or you are not sure, ask them to spell it.

3. CALLBACK NUMBER. Say something like: "I can see you're calling from [say the number naturally, or the last four digits]. Is that the best number to call you back on?"
   • If yes, use the CALLER ID number.
   • If no, ask for the number they want used instead.
   • Always read the callback number back digit by digit and wait for them to confirm, whether it is the caller ID or a different number.

4. REASON. Understand briefly why they are calling.

5. READ BACK BEFORE YOU END. Before transferring or ending the call, read back the caller's name and their company (if you captured one), and read the callback number digit by digit. Example: "Just to confirm, I'm speaking with [Name] from [Company], and the number to call back is [digits one by one]. Is that all correct?"
   • If either the name or the company is unusual or you are still uncertain, ask them to spell it before you finish.
   • Only transfer or promise a callback after they confirm.

Returning callers: if CALLER MEMORY shows their name (and company), greet them by name and skip re-asking unless something might have changed. Still read the callback number back digit by digit if you are arranging follow-up.

Keep it warm and conversational. This is a phone call, not a form.`;

function buildCallerIntakeSection(options = {}) {
  if (options.metadata && !isCallerIntakeEnabled(options.metadata)) return null;

  const parts = [];
  const callerBlock = buildCallerIdBlock(options.callerId);
  if (callerBlock) parts.push(callerBlock);
  parts.push(CALLER_INTAKE_PROMPT);
  return parts.join("\n\n");
}

module.exports = {
  isCallerIntakeEnabled,
  buildCallerIdBlock,
  buildCallerIntakeSection,
  CALLER_INTAKE_PROMPT,
};
