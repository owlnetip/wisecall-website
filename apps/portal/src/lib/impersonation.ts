// Cookie names for admin "view as customer" impersonation. Kept in a plain module
// (not the "use server" actions file, which may only export async functions).
export const IMPERSONATE_COOKIE = "wc_impersonate";
// When set alongside IMPERSONATE_COOKIE, dashboard data is locked to this
// wisecall_profiles id (inbox, contacts, insights, channel numbers). Missing
// or unowned ids fail closed to an empty inbox — they never widen to the
// customer's global feed.
export const IMPERSONATE_AGENT_COOKIE = "wc_impersonate_agent";
