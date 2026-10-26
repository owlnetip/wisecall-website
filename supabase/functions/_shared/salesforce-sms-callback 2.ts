/** Supabase can pack the optional preview bypass into the existing secret slot.
 * The portal still receives only the plain SMS authentication secret.
 */
export function salesforceCallbackHeaders(raw: string): Record<string, string> {
  let secret = raw.trim();
  let bypass = "";
  if (secret.startsWith("{")) {
    const config = JSON.parse(secret);
    if (!config || typeof config.secret !== "string") throw new Error("Invalid SMS callback configuration");
    secret = config.secret;
    if (config.vercel_bypass !== undefined && typeof config.vercel_bypass !== "string") {
      throw new Error("Invalid SMS callback bypass configuration");
    }
    bypass = config.vercel_bypass || "";
  }
  if (!secret || /[\r\n]/.test(secret + bypass)) throw new Error("Missing or invalid SMS callback secret");
  return {
    "Content-Type": "application/json",
    "x-wisecall-salesforce-secret": secret,
    ...(bypass ? { "x-vercel-protection-bypass": bypass } : {}),
  };
}

export async function postSalesforceCallback(
  portal: string,
  rawSecret: string,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ delivered: boolean; status: number }> {
  const url = new URL(portal);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("Invalid SMS callback origin");
  }
  url.pathname = "/api/integrations/salesforce/sms/inbound";
  const response = await fetchImpl(url, {
    method: "POST",
    headers: salesforceCallbackHeaders(rawSecret),
    body: JSON.stringify(payload),
    // Never forward authentication or customer messages across a redirect.
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  const result = await response.json().catch(() => null);
  return { delivered: response.ok && result?.routed === true && result?.delivered === true, status: response.status };
}
