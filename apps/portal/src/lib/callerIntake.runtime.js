// callerIntake.runtime.js — synced from wisecall-edge/src/lib/callerIntake.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

// Standard caller-intake instructions — synced from apps/portal/src/lib/caller-intake.ts

function isCallerIntakeEnabled(metadata) {
  return metadata?.caller_intake_enabled !== false;
}

function buildCallerIdBlock(callerId) {
  const id = (callerId ?? "").trim();
  if (!id) return null;
  return [
    "[CALLER ID]",
    `Line number for this call: ${id}`,
    "Treat this as the default callback number. Ask the caller to confirm it is the best number to reach them — only collect a different number if they say no.",
  ].join("\n");
}

const CALLER_INTAKE_PROMPT = `[CALLER DETAILS — collect before messages, callbacks, or transfers]

You receive the caller's line number automatically (see CALLER ID above when present). Use it — do not ask them to read out that number unless they want a different callback number.

When taking a message, arranging a callback, or transferring the call:

1. NAME — If CALLER MEMORY does not already give their name, ask naturally: "May I take your name?" Spell back unusual names once.

2. CALLBACK NUMBER — Say something like: "I can see you're calling from [say the number naturally, or the last four digits]. Is that the best number to call you back on?"
   • If yes → use the CALLER ID number as the confirmed callback.
   • If no → ask for their mobile, then read it back digit by digit and ask them to confirm.

3. COMPANY (when relevant) — For business or trade enquiries ask: "Which company are you calling from?" Skip for obvious personal calls.

4. REASON — Understand briefly why they are calling.

5. CONFIRM BEFORE HANDOFF — Before transferring or ending, summarise once: "Just to confirm — [Name], calling back on [number], about [reason]. Is that all correct?"
   • Only transfer or promise a callback after they confirm.

Returning callers: if CALLER MEMORY shows their name (and company), greet them by name and skip re-asking unless something might have changed — still confirm the callback number if you are arranging follow-up.

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
