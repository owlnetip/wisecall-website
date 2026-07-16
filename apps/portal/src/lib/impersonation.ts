// Cookie names for admin "view as customer" impersonation. Kept in a plain module
// (not the "use server" actions file, which may only export async functions).
export const IMPERSONATE_COOKIE = "wc_impersonate";
// Optional: when set alongside IMPERSONATE_COOKIE, dashboard data is scoped to
// this agent profile only (calls, contacts, insights, etc.).
export const IMPERSONATE_AGENT_COOKIE = "wc_impersonate_agent";
