// Website URL + setup wizard carried from wisecall.io/try through no-card signup.
//
// There is no /wizard or /dashboard/setup route. Create-agent is a full-screen
// overlay (SetupWizard) on /dashboard, the same UI as "+ New agent" /
// "Set up my receptionist". ?setup=1 opens it on first paint so trial signups
// never see the Agents empty state. ?website= prefills step 1.

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

export function shouldOpenSetupWizard(opts: {
  setup?: unknown;
  website?: unknown;
  agentCount: number;
}): boolean {
  if (opts.agentCount > 0) return false;
  return parseOpenSetup(opts.setup) || Boolean(parseSetupWebsite(opts.website));
}
