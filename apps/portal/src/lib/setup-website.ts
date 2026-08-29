// Website URL + setup wizard carried from wisecall.io/try.
//
// Facebook /try is agent-first: visitors paste a website and UK mobile, then
// public app.wisecall.io/setup drafts THEIR agent (Gemma, 24/7) and rings that
// guest profile the moment it is ready — no second tap, never Ava.
// Email + password is not the wall; hangup signup can still offer 20 free calls.
// Homepage "Try it now" is still signup-first.
//
// wisecall.io/setup is only a Vercel redirect into this portal route. Do not
// add a marketing landing at setup/index.html — that rings the generic Ava
// demo (profile_slug wisecall) and was rejected.
//
// There is no /wizard or /dashboard/setup route. Create-agent is a full-screen
// overlay (SetupWizard) on /dashboard, the same UI as "+ New agent" /
// "Set up my receptionist". ?setup=1 opens it on first paint so signed-in
// trial users never see the Agents empty state. ?website= prefills step 1.

const MAX_WEBSITE_LENGTH = 300;

export function parseSetupWebsite(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let raw = input.trim();
  if (!raw || raw.length > MAX_WEBSITE_LENGTH) return null;
  if (/[\s<>]/.test(raw)) return null;
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;

  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;

    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (!host || host === "localhost" || !host.includes(".")) return null;

    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function parseOpenSetup(input: unknown): boolean {
  if (typeof input !== "string") return false;
  const value = input.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

// Post-signup landing for the 20-call path. Always opens the wizard; website is optional.
export function dashboardSetupPath(website?: unknown): string {
  const params = new URLSearchParams({ setup: "1" });
  const parsed = parseSetupWebsite(website);
  if (parsed) params.set("website", parsed);
  return `/dashboard?${params.toString()}`;
}

// Public guest wizard for wisecall.io/try. No account until after they hear the call.
export function guestSetupPath(website?: unknown): string {
  const params = new URLSearchParams({ trial: "calls" });
  const parsed = parseSetupWebsite(website);
  if (parsed) params.set("website", parsed);
  return `/setup?${params.toString()}`;
}

export function shouldOpenSetupWizard(opts: {
  setup?: unknown;
  website?: unknown;
  agentCount: number;
}): boolean {
  if (opts.agentCount > 0) return false;
  return parseOpenSetup(opts.setup) || Boolean(parseSetupWebsite(opts.website));
}
