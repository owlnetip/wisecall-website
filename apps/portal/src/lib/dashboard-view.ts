// Sidebar tabs on /dashboard. Home and Agents share this route; the active
// panel is client state (and an optional ?view= query). There is no nested
// /dashboard/agents URL — the founder's Agents screenshot is still /dashboard.
export const DASHBOARD_VIEWS = [
  "insights",
  "assistants",
  "calls",
  "contacts",
  "viewings",
  "negotiator",
  "channels",
] as const;

export type DashboardView = (typeof DASHBOARD_VIEWS)[number];

// Post-auth landing (login, no-card signup, Stripe return, password reset,
// generic /dashboard). Agents is the product they signed up to create.
export const DEFAULT_DASHBOARD_VIEW: DashboardView = "assistants";

const VIEW_ALIASES: Record<string, DashboardView> = {
  home: "insights",
  insights: "insights",
  agents: "assistants",
  assistants: "assistants",
  inbox: "calls",
  calls: "calls",
  contacts: "contacts",
  channels: "channels",
  negotiator: "negotiator",
  viewings: "viewings",
};

export function parseDashboardView(value: unknown): DashboardView {
  if (typeof value !== "string") return DEFAULT_DASHBOARD_VIEW;
  return VIEW_ALIASES[value.trim().toLowerCase()] ?? DEFAULT_DASHBOARD_VIEW;
}
