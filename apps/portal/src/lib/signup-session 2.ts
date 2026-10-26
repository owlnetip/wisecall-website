// When Confirm email is on in Supabase, signUp() creates the user but does not
// return a session. Facebook /try traffic cannot survive that extra click.
// We auto-confirm ONLY the no-card trial path, then sign them in. Other signups
// still wait for the inbox link. Project-wide Confirm email stays on.

export function shouldAutoConfirmNoCardSignup(input: {
  noCard: boolean;
  hasSession: boolean;
  userId?: string | null;
  identities?: unknown[] | null;
}): boolean {
  if (!input.noCard || input.hasSession) return false;
  if (!input.userId) return false;
  // Supabase returns an empty identities array when the email is already
  // registered (anti-enumeration). Do not "confirm" that fake user.
  if (Array.isArray(input.identities) && input.identities.length === 0) return false;
  return true;
}

export function isLikelyExistingSignup(identities?: unknown[] | null): boolean {
  return Array.isArray(identities) && identities.length === 0;
}

// Guest /setup finishes signup in-place (then creates the agent in the same
// request). Homepage / 7-day signup still redirect as before.
export function wantsStayOnPage(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const value = input.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}
