import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function sha1(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function xmlTag(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m?.[1]?.trim() || null;
}

function morError(xml: string): string | null {
  return xmlTag(xml, "error") || xmlTag(xml, "e");
}

async function morGet(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`MOR HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

async function morPost(url: string, params: URLSearchParams): Promise<string> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`MOR HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

function generateSecret(len = 20): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => chars[b % chars.length]).join("");
}

// Derive the SIP/API host from MOR_API_URL (strips scheme and path).
function morSipDomain(morApiUrl: string): string {
  try {
    return new URL(morApiUrl).hostname;
  } catch {
    return morApiUrl.replace(/^https?:\/\//, "").split("/")[0];
  }
}

function morLoginUsername(username: string): string {
  return username.trim().replace(/ /g, "_");
}

async function resolveResellerUsername(
  supabase: any,
  resellerId: string,
  configuredUsername: string,
): Promise<string> {
  if (configuredUsername.trim()) return morLoginUsername(configuredUsername);

  const { data, error } = await supabase
    .from("reseller_credentials")
    .select("reseller_name")
    .eq("reseller_id", resellerId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up MOR reseller ${resellerId}: ${error.message}`);
  }
  const row = data as { reseller_name?: string } | null;
  if (!row?.reseller_name) {
    throw new Error(
      `MOR_WISECALL_RESELLER_USERNAME is not configured and no active reseller_credentials row exists for ${resellerId}`,
    );
  }

  return morLoginUsername(row.reseller_name);
}

// ─── main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Service-role only. This function provisions paid MOR resources and is
    // called from the Next.js server action, never directly from the browser.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const providedKey = (req.headers.get("apikey") || "").trim();
    if (providedKey !== SERVICE_ROLE_KEY) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const { profile_id } = await req.json();
    if (!profile_id) return json({ ok: false, error: "profile_id required" }, 400);

    const MOR_API_URL = Deno.env.get("MOR_API_URL");
    const MOR_API_SECRET = Deno.env.get("MOR_API_SECRET");
    const MOR_UNIQUE_HASH = Deno.env.get("MOR_UNIQUE_HASH");
    const MOR_ADMIN_PASSWORD = Deno.env.get("MOR_API_PASSWORD") || "";
    const MOR_SIP_HOST = Deno.env.get("MOR_SIP_DOMAIN") ||
      (MOR_API_URL ? morSipDomain(MOR_API_URL) : "");
    // Owlnet reseller that owns the pooled DIDs (reseller_credentials.reseller_id).
    const MOR_RESELLER_ID = Deno.env.get("MOR_WISECALL_RESELLER_ID") || "7171";
    const MOR_RESELLER_USERNAME = Deno.env.get("MOR_WISECALL_RESELLER_USERNAME") || "";

    if (!MOR_API_URL || !MOR_API_SECRET || !MOR_UNIQUE_HASH) {
      throw new Error("MOR credentials not configured (MOR_API_URL / MOR_API_SECRET / MOR_UNIQUE_HASH)");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    // Deterministic username — same on every attempt for this profile.
    const morUsername = "wca" + profile_id.replace(/-/g, "").slice(0, 10);

    // ── 0. Check for existing partial provisioning (idempotency) ──────────
    // If a previous attempt already reserved a DID and created MOR resources,
    // pick up from where it left off rather than creating a second user.
    const { data: existingPool } = await supabase
      .from("wisecall_mor_ddi_pool")
      .select("*")
      .eq("profile_id", profile_id)
      .in("status", ["reserved", "assigned"])
      .maybeSingle();

    const { data: existingSip } = await supabase
      .from("wisecall_sip_endpoints")
      .select("sip_username, sip_password, mor_device_id")
      .eq("profile_id", profile_id)
      .maybeSingle();

    let didPoolId = "";
    let didNumber = "";
    let morUserId = "";
    let morDeviceId = "";
    let deviceUsername = "";
    let sipPassword = "";

    if (existingPool?.mor_user_id && existingPool?.mor_device_id) {
      // Full partial state available — skip user + device creation entirely.
      didPoolId = existingPool.id;
      didNumber = existingPool.did_number;
      morUserId = existingPool.mor_user_id;
      morDeviceId = existingPool.mor_device_id;
      deviceUsername = existingSip?.sip_username || morUsername;
      sipPassword = existingSip?.sip_password || generateSecret();
      console.log(`♻️ Resuming provisioning: DID ${didNumber} user ${morUserId} device ${morDeviceId}`);
    } else {
      // ── 1. Reserve a free DID ──────────────────────────────────────────────
      // If already reserved for this profile, the SQL fn returns the existing row.
      const { data: didRows, error: didErr } = await supabase.rpc(
        "wisecall_reserve_mor_did",
        { p_profile_id: profile_id }
      );
      if (didErr) throw new Error(`DID reservation failed: ${didErr.message}`);
      const didRow = Array.isArray(didRows) ? didRows[0] : didRows;
      if (!didRow) throw new Error("No available MOR DIDs in pool — all 100 assigned");
      didPoolId = didRow.id;
      didNumber = didRow.did_number;
      console.log(`✅ Reserved DID ${didNumber} (pool id ${didPoolId})`);

      sipPassword = generateSecret();
      const morPassword = generateSecret();

      // ── 2. Create MOR user ───────────────────────────────────────────────
      const userParams = new URLSearchParams({
        hash: MOR_UNIQUE_HASH.trim(),
        username: morUsername,
        password: morPassword,
        password2: morPassword,
        first_name: "WiseCall",
        last_name: "Agent",
        email: `${morUsername}@wisecall.io`,
        device_type: "SIP",
        country_id: "80",
      });

      const userXml = await morPost(`${MOR_API_URL}/billing/api/user_register`, userParams);
      console.log("MOR user_register response:", userXml.slice(0, 400));
      const userErr = morError(userXml);
      if (userErr) {
        if (/username.*taken|already.*taken/i.test(userErr)) {
          // User was created in a previous attempt — look up their ID from users_get.
          console.log(`⚠️ Username ${morUsername} already exists, looking up user_id…`);
          const usersXml = await morGet(
            `${MOR_API_URL}/billing/api/users_get?` +
            new URLSearchParams({ u: "admin", p: MOR_ADMIN_PASSWORD, hash: MOR_UNIQUE_HASH.trim() })
          );
          const userBlocks = usersXml.match(/<user>([\s\S]*?)<\/user>/gi) || [];
          for (const block of userBlocks) {
            if (block.includes(`<username>${morUsername}</username>`)) {
              morUserId = xmlTag(block, "id") ?? "";
              break;
            }
          }
          if (!morUserId) throw new Error(`MOR user ${morUsername} already exists but could not find their ID`);
          console.log(`♻️ Found existing MOR user: id=${morUserId}`);
        } else {
          throw new Error(`MOR user_register failed: ${userErr}`);
        }
      } else {
        morUserId = xmlTag(userXml, "user_id") ?? "";
        if (!morUserId) throw new Error("MOR user_register: no user_id in response");
        console.log(`✅ MOR user created: id=${morUserId} username=${morUsername}`);
      }

      // ── 3. Create SIP device under the new user ──────────────────────────
      const adminHash = await sha1(`admin${MOR_ADMIN_PASSWORD}${MOR_API_SECRET}`);
      const deviceParams = new URLSearchParams({
        u: "admin",
        p: MOR_ADMIN_PASSWORD,
        hash: adminHash,
        user_id: morUserId,
        description: `WiseCall agent ${profile_id.slice(0, 8)}`,
        type: "SIP",
        device_type: "SIP",
      });

      const deviceXml = await morPost(`${MOR_API_URL}/billing/api/device_create`, deviceParams);
      console.log("MOR device_create response:", deviceXml.slice(0, 400));
      const deviceErr = morError(deviceXml);
      let deviceSourceXml = deviceXml;
      if (deviceErr) {
        // If device already exists for this user, look it up via devices_get.
        console.warn(`⚠️ device_create error: ${deviceErr} — looking up existing device for user ${morUserId}`);
        const devicesXml = await morGet(
          `${MOR_API_URL}/billing/api/devices_get?` +
          new URLSearchParams({ u: "admin", p: MOR_ADMIN_PASSWORD, hash: MOR_UNIQUE_HASH.trim(), user_id: morUserId })
        );
        console.log("MOR devices_get response:", devicesXml.slice(0, 400));
        morDeviceId = xmlTag(devicesXml, "device_id") || xmlTag(devicesXml, "id") || "";
        if (!morDeviceId) throw new Error(`MOR device_create failed: ${deviceErr}`);
        deviceSourceXml = devicesXml;
        console.log(`♻️ Found existing MOR device: id=${morDeviceId}`);
      } else {
        morDeviceId = xmlTag(deviceXml, "device_id") || xmlTag(deviceXml, "id") || "";
        if (!morDeviceId) throw new Error("MOR device_create: no device_id in response");
        console.log(`✅ MOR device created: id=${morDeviceId}`);
      }

      deviceUsername = xmlTag(deviceSourceXml, "username") || xmlTag(deviceSourceXml, "name") || morUsername;

      // ── 4. Set SIP secret ────────────────────────────────────────────────
      const updateHash = await sha1(`admin${MOR_ADMIN_PASSWORD}${MOR_API_SECRET}`);
      const updateParams = new URLSearchParams({
        u: "admin",
        p: MOR_ADMIN_PASSWORD,
        hash: updateHash,
        device_id: morDeviceId,
        secret: sipPassword,
      });
      const updateXml = await morPost(`${MOR_API_URL}/billing/api/device_details_update`, updateParams);
      console.log("MOR device_details_update response:", updateXml.slice(0, 200));
      const updateErr = morError(updateXml);
      if (updateErr) console.warn(`⚠️ MOR device_details_update warning: ${updateErr}`);

      // Save MOR IDs to pool now so retries can skip user/device creation.
      await supabase
        .from("wisecall_mor_ddi_pool")
        .update({ mor_user_id: morUserId, mor_device_id: morDeviceId })
        .eq("id", didPoolId);
    }

    const apiSecret = MOR_API_SECRET.trim();

    // ── 5a. Resolve the DID's internal id via dids_get ───────────────────────
    const didsGetUrl = `${MOR_API_URL}/billing/api/dids_get?` +
      new URLSearchParams({
        u: "admin",
        s_user: "all",
        s_call_type: "all",
        s_device: "all",
        s_reseller: "all",
        search_did_number: didNumber,
        hash: MOR_UNIQUE_HASH.trim(),
      });
    const didsGetXml = await morGet(didsGetUrl);
    console.log("MOR dids_get response (full):", didsGetXml);
    const lastDigits = (s: string) => s.replace(/\D/g, "").slice(-10);
    const wantTail = lastDigits(didNumber);
    // Each DID row is <did><did>NUMBER</did>…fields…<id>INTERNAL_ID</id></did>.
    // The nested <did> number field breaks a naive non-greedy match, so match the
    // outer row explicitly: skip the nested <did>…</did>, capture the rest, read <id>.
    let didId = "";
    const rowRegex = /<did>\s*<did>([^<]*)<\/did>([\s\S]*?)<\/did>/gi;
    let m: RegExpExecArray | null;
    while ((m = rowRegex.exec(didsGetXml)) !== null) {
      const rowNum = m[1];
      const rowBody = m[2];
      if (lastDigits(rowNum) === wantTail) {
        didId = xmlTag(rowBody, "id") || xmlTag(rowBody, "did_id") || "";
        break;
      }
    }
    // Fallback: single-row response — just grab the first numeric <id>.
    if (!didId && wantTail) {
      const idMatch = didsGetXml.match(/<id>(\d+)<\/id>/);
      if (idMatch && didsGetXml.includes(didNumber)) didId = idMatch[1];
    }
    if (!didId) {
      throw new Error(
        `Could not resolve MOR DID id for ${didNumber}. dids_get returned: ${didsGetXml.slice(0, 600)}`,
      );
    }
    console.log(`✅ Resolved DID ${didNumber} → internal id ${didId}`);

    // "Already assigned/reserved" means a previous attempt got this far — treat as
    // success and continue so the agent still gets marked live (idempotent retry).
    const alreadyDone = (e: string | null) =>
      !!e && /already.*(assigned|reserved)|is already/i.test(e);

    const resellerUsername = await resolveResellerUsername(
      supabase,
      MOR_RESELLER_ID,
      MOR_RESELLER_USERNAME,
    );
    console.log(`✅ Using MOR reseller ${resellerUsername} (${MOR_RESELLER_ID}) for DID assignment`);

    // ── 5b. Reserve the DID to the reseller ─────────────────────────────────
    // Matches the working Numbers flow: first move the free DID onto the reseller
    // account using the DID's internal id.
    const reserveHash = await sha1(`${didId}${apiSecret}`);
    const reserveXml = await morGet(
      `${MOR_API_URL}/billing/api/did_details_update?` +
      new URLSearchParams({ u: "admin", did_id: didId, did_user_id: MOR_RESELLER_ID, hash: reserveHash }),
    );
    console.log("MOR did_details_update (reserve→reseller) response:", reserveXml.slice(0, 200));

    const reserveErr = morError(reserveXml);
    if (reserveErr && !alreadyDone(reserveErr)) {
      throw new Error(`MOR DID reserve to reseller failed: ${reserveErr}`);
    }

    // ── 5c. Assign the reseller-owned DID to the MOR user ───────────────────
    // did_details_update reports success on this MOR but does not reliably set
    // the owner. The Numbers page uses did_assign with the reseller login.
    const userHash = await sha1(`${resellerUsername}${apiSecret}${didNumber}${morUserId}`);
    const userXml = await morGet(
      `${MOR_API_URL}/billing/api/did_assign?` +
      new URLSearchParams({
        u: resellerUsername,
        hash: userHash,
        did: didNumber,
        user_id: morUserId,
      }),
    );
    console.log("MOR did_assign (reseller→user) response:", userXml.slice(0, 300));
    const userAssignErr = morError(userXml);
    if (userAssignErr && !alreadyDone(userAssignErr)) {
      throw new Error(`MOR DID user assign failed: ${userAssignErr}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2_000));

    // ── 5d. Bind the now-user-owned DID to the SIP device ───────────────────
    // The Numbers proxy tries the MOR hash variants seen across instances. If
    // the device is not a trunk, retry the non-trunk endpoint.
    async function assignDidToDeviceWithEndpoint(endpoint: string): Promise<{ xml: string; err: string | null }> {
      const hashInputs = [
        `${didNumber}${morDeviceId}${apiSecret}`,
        `${morDeviceId}${didNumber}${apiSecret}`,
        `${resellerUsername}${apiSecret}`,
      ];

      let lastXml = "";
      let lastErr: string | null = null;
      for (const hashInput of hashInputs) {
        const hash = await sha1(hashInput);
        const xml = await morGet(
          `${MOR_API_URL}/billing/api/${endpoint}?` +
          new URLSearchParams({
            u: resellerUsername,
            did: didNumber,
            device_id: morDeviceId,
            hash,
          }),
        );
        lastXml = xml;
        lastErr = morError(xml);
        if (!lastErr) return { xml, err: null };
        if (!/incorrect hash/i.test(lastErr)) return { xml, err: lastErr };
        console.log(`⚠️ ${endpoint} returned Incorrect hash; trying alternate known hash pattern`);
      }

      return { xml: lastXml, err: lastErr };
    }

    async function assignDidToDevice(endpoint: string): Promise<string> {
      let result = await assignDidToDeviceWithEndpoint(endpoint);
      if (result.err && endpoint === "did_trunk_device_assign" && /not a trunk/i.test(result.err)) {
        console.log("⚠️ Device not a trunk; retrying with did_device_assign");
        result = await assignDidToDeviceWithEndpoint("did_device_assign");
      }
      if (result.err && !alreadyDone(result.err)) {
        throw new Error(`MOR DID device assign failed: ${result.err}`);
      }
      return result.xml;
    }

    let didXml = await assignDidToDevice("did_trunk_device_assign");
    let didAssignErr = morError(didXml);
    console.log("MOR device assign response:", didXml.slice(0, 200));
    if (didAssignErr && alreadyDone(didAssignErr)) didAssignErr = null;
    console.log(`✅ DID ${didNumber} bound to user ${morUserId} / device ${morDeviceId}`);

    // ── 6. Insert wisecall_sip_endpoints (bridge auto-picks it up in ~30s) ─
    const { error: sipErr } = await supabase.from("wisecall_sip_endpoints").insert({
      profile_id,
      pbx_type: "mor",
      sip_username: deviceUsername,
      sip_password: sipPassword,
      sip_domain: MOR_SIP_HOST,
      sip_proxy: MOR_SIP_HOST,
      transport: "udp",
      is_enabled: true,
      mor_device_id: morDeviceId,
    });
    if (sipErr) throw new Error(`wisecall_sip_endpoints insert: ${sipErr.message}`);
    console.log(`✅ SIP endpoint inserted: ${deviceUsername}@${MOR_SIP_HOST}`);

    // ── 7. Update agent profile: routing + number ─────────────────────────
    const { data: profileRow } = await supabase
      .from("wisecall_profiles")
      .select("metadata")
      .eq("id", profile_id)
      .single();

    const metadata = (profileRow?.metadata as Record<string, unknown>) ?? {};
    const routing = {
      provider: "mor_sip",
      number: didNumber,
      status: "live",
      sipUsername: deviceUsername,
      sipDomain: MOR_SIP_HOST,
      morUserId,
      morDeviceId,
    };

    const { error: profileErr } = await supabase
      .from("wisecall_profiles")
      .update({
        telnyx_number: didNumber,
        metadata: { ...metadata, routing },
        is_active: true,
      })
      .eq("id", profile_id);
    if (profileErr) throw new Error(`wisecall_profiles update: ${profileErr.message}`);

    // ── 8. Mark DID as assigned in pool ───────────────────────────────────
    await supabase
      .from("wisecall_mor_ddi_pool")
      .update({
        status: "assigned",
        profile_id,
        mor_device_id: morDeviceId,
        mor_user_id: morUserId,
        assigned_at: new Date().toISOString(),
      })
      .eq("id", didPoolId);

    console.log(`✅ Provisioning complete for profile ${profile_id}: DID ${didNumber}`);

    return json({
      ok: true,
      routing,
      did: didNumber,
      morUserId,
      morDeviceId,
      sipUsername: deviceUsername,
      sipDomain: MOR_SIP_HOST,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("❌ Provisioning failed:", message);
    return json({ ok: false, error: message }, 500);
  }
});
