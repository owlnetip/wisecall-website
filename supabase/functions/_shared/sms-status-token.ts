// Token for the Vonage delivery-status webhook URL. Derived (HMAC-SHA256) from
// the existing Salesforce SMS secret rather than stored separately: the
// project is at Supabase's 100-secret limit, and the raw secret must never
// appear in a URL that Vonage logs.
export async function smsStatusToken(): Promise<string> {
  let raw = (Deno.env.get("WISECALL_SALESFORCE_SMS_SECRET") || "").trim();
  if (raw.startsWith("{")) {
    try {
      raw = String(JSON.parse(raw).secret || "");
    } catch {
      raw = "";
    }
  }
  if (!raw) return "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(raw), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("wisecall-sms-status"));
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
