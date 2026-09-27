// callerIntake.runtime.js, synced from wisecall-edge/src/lib/callerIntake.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

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

The company name is the most important detail on the call. Never invent, guess, or tidy a company name. Record only what the caller said and confirmed.

1. NAME. If CALLER MEMORY does not already give their name, ask: "Who am I speaking with?"
   • Store a single caller's name only. If they mention several people, ask which name is theirs and keep only that one.
   • If the name is unusual, unclear, or you are not sure you heard it, ask them to spell it, then read the spelling back.

2. COMPANY. Ask this on every call, right after the name: "And which company are you calling from?"
   • Company is required. Do not skip it, and do not end or transfer the call without an answer.
   • If they are calling personally, or they have no company, record that explicitly. Say it back, for example: "You're calling personally, with no company." Do not guess a company for them.
   • Unless the company is an obviously well-known brand, always ask the caller to spell the company.
   • Read the company back letter-for-letter or word-for-word and get an explicit yes before you end or transfer the call.
   • If the caller corrects it, read the corrected company back letter-for-letter or word-for-word and get another explicit yes.

3. CALLBACK NUMBER. Say something like: "I can see you're calling from [say the number naturally, or the last four digits]. Is that the best number to call you back on?"
   • If yes, use the CALLER ID number.
   • If no, ask for the number they want used instead.
   • Always read the callback number back digit by digit and wait for them to confirm, whether it is the caller ID or a different number.

4. REASON. Understand briefly why they are calling.

5. READ BACK BEFORE YOU END. Before transferring or ending the call, read back the caller's name and their company, and read the callback number digit by digit. Get an explicit yes. Example: "Just to confirm, I'm speaking with [Name] from [Company], and the number to call back is [digits one by one]. Is that all correct?"
   • Read the company letter-for-letter or word-for-word, including for a well-known brand.
   • For a personal call, read that back instead: "Just to confirm, I'm speaking with [Name], you're calling personally with no company, and the number to call back is [digits one by one]. Is that all correct?"
   • If they correct the company, re-read the corrected version and wait for an explicit yes.
   • Only transfer, end, or promise a callback after they confirm.

Returning callers: if CALLER MEMORY shows their name and company, greet them by name and skip re-asking unless something might have changed. Still read the company and the callback number back and get an explicit yes if you are arranging follow-up.

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
