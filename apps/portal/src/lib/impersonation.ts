// Cookie name for admin "view as customer" impersonation. Kept in a plain module
// (not the "use server" actions file, which may only export async functions).
export const IMPERSONATE_COOKIE = "wc_impersonate";
