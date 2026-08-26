import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  findReusableMorUserId,
  morDeviceDescription,
  morUsernameForAccount,
  morUserNameParts,
  profileAgentName,
  profileBusinessName,
} from "../_shared/wisecall-mor-account.mjs";

// ─── helpers ─────────────────────────────────────────────────────────────────

async function sha1(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-256", data);
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

function morResponseError(xml: string): string | null {
  return morError(xml) || (/access denied/i.test(xml) ? "Access Denied" : null);
}

function shouldTryAlternateAuth(xml: string, error: string | null): boolean {
  return /incorrect hash|access denied/i.test(`${error || ""} ${xml}`);
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
  const uppercase = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lowercase = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const chars = `${uppercase}${lowercase}${digits}`;
  const required = [uppercase, lowercase, digits].map((set) => {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    return set[byte[0] % set.length];
  });
  const bytes = new Uint8Array(Math.max(0, len - required.length));
  crypto.getRandomValues(bytes);
  const password = [
    ...required,
    ...Array.from(bytes).map((b) => chars[b % chars.length]),
  ];
  for (let i = password.length - 1; i > 0; i--) {
    const byte = new Uint8Array(1);
    crypto.getRandomValues(byte);
    const j = byte[0] % (i + 1);
    [password[i], password[j]] = [password[j], password[i]];
  }
  return password.join("");
}

// Derive the SIP/API host from MOR_API_URL (strips scheme and path).
function morSipDomain(morApiUrl: string): string {
  try {
    return new URL(morApiUrl).hostname;
  } catch {
    return morApiUrl.replace(/^https?:\/\//, "").split("/")[0];
  }
}

// MOR rejects SIP REGISTER with 403 when the bridge uses sip.owlnet.io even
// though it resolves to the same host; the bare IP is required for registration.
function normalizeMorSipHost(host: string): string {
  const trimmed = host.trim();
  if (!trimmed) return trimmed;
  if (trimmed.toLowerCase() === "sip.owlnet.io") return "54.38.148.116";
  return trimmed;
}

function morLoginUsername(username: string): string {
  return username.trim().replace(/ /g, "_");
}

function morDeviceBlocks(xml: string): string[] {
  return xml.match(/<device>[\s\S]*?<\/device>/gi) || [];
}

function morDeviceBlock(xml: string, deviceId: string): string {
  const blocks = morDeviceBlocks(xml);
  return blocks.find((block) =>
    xmlTag(block, "device_id") === deviceId || xmlTag(block, "id") === deviceId
  ) || blocks[0] || "";
}

async function resolveResellerCredentials(
  supabase: any,
  resellerId: string,
  configuredUsername: string,
): Promise<{
  resellerId: string;
  username: string;
  password: string;
  apiKey: string;
  uniqueHash: string;
}> {
  const { data, error } = await supabase
    .from("reseller_credentials")
    .select("reseller_id, reseller_name, password, unique_hash, api_key")
    .eq("reseller_id", resellerId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to look up MOR reseller ${resellerId}: ${error.message}`);
  }
  const row = data as {
    reseller_id?: string | number;
    reseller_name?: string;
    password?: string | null;
    unique_hash?: string | null;
    api_key?: string | null;
  } | null;
  if (!row?.reseller_id) {
    throw new Error(
      `MOR_WISECALL_RESELLER_USERNAME is not configured and no active reseller_credentials row exists for ${resellerId}`,
    );
  }

  const apiKey = String(row.api_key || row.unique_hash || "").trim();
  const uniqueHash = String(row.unique_hash || "").trim();
  if (!apiKey && !uniqueHash) {
    throw new Error(`MOR reseller ${resellerId} has no api_key or unique_hash configured`);
  }

  return {
    resellerId: String(row.reseller_id),
    username: morLoginUsername(configuredUsername.trim() || row.reseller_name || resellerId),
    password: String(row.password || "").trim(),
    apiKey: apiKey || uniqueHash,
    uniqueHash,
  };
}

async function syncMorDevicePassword(options: {
  morApiUrl: string;
  resellerUsername: string;
  reseller: {
    password: string;
    apiKey: string;
    uniqueHash: string;
  };
  morUserId: string;
  morDeviceId: string;
  deviceUsername: string;
  sipPassword: string;
}): Promise<string> {
  const {
    morApiUrl,
    resellerUsername,
    reseller,
    morUserId,
    morDeviceId,
    deviceUsername,
    sipPassword,
  } = options;

  const deviceHash = reseller.uniqueHash || await sha1(`${morUserId}${reseller.apiKey}`);
  const devicesParams = new URLSearchParams({
    u: resellerUsername,
    hash: deviceHash,
    user_id: morUserId,
    show_hidden_devices: "0",
  });
  if (reseller.password) devicesParams.set("p", reseller.password);

  const devicesXml = await morGet(
    `${morApiUrl}/billing/api/devices_get?${devicesParams.toString()}`,
  );
  const block = morDeviceBlock(devicesXml, morDeviceId);
  if (!block) throw new Error(`MOR devices_get: device ${morDeviceId} was not found`);

  const usernameForHash = xmlTag(block, "username") || deviceUsername;
  const authentication = xmlTag(block, "authentication") || "0";
  const host = xmlTag(block, "ipaddr") || xmlTag(block, "host") || "dynamic";
  const port = xmlTag(block, "port") || "5060";
  const updateHash = await sha1(
    `${morDeviceId}${authentication}${usernameForHash}${host}${port}${reseller.apiKey}`,
  );

  const updateParams = new URLSearchParams({
    u: resellerUsername,
    device: morDeviceId,
    authentication,
    username: usernameForHash,
    host,
    port,
    hash: updateHash,
    password: sipPassword,
    device_type: "SIP",
  });
  if (reseller.password) updateParams.set("p", reseller.password);

  const updateXml = await morGet(
    `${morApiUrl}/billing/api/device_update?${updateParams.toString()}`,
  );
  console.log("MOR device_update password response:", updateXml.slice(0, 200));
  const updateErr = morResponseError(updateXml);
  if (updateErr) throw new Error(`MOR device_update password failed: ${updateErr}`);

  const verifyXml = await morGet(
    `${morApiUrl}/billing/api/devices_get?${devicesParams.toString()}`,
  );
  const verifyBlock = morDeviceBlock(verifyXml, morDeviceId);
  const morPassword = xmlTag(verifyBlock, "secret") || xmlTag(verifyBlock, "password");
  if (morPassword && morPassword !== sipPassword) {
    throw new Error("MOR device_update password did not match the saved SIP password");
  }

  return usernameForHash;
}

async function updateMorUserDisplayName(options: {
  morApiUrl: string;
  resellerUsername: string;
  reseller: { password: string; apiKey: string; uniqueHash: string };
  morUserId: string;
  firstName: string;
  lastName: string;
}): Promise<void> {
  const { morApiUrl, resellerUsername, reseller, morUserId, firstName, lastName } = options;
  const params = new URLSearchParams({
    u: resellerUsername,
    user_id: morUserId,
    first_name: firstName,
    last_name: lastName,
    hash: reseller.uniqueHash || await sha1(`${morUserId}${reseller.apiKey}`),
  });
  if (reseller.password) params.set("p", reseller.password);

  let xml = await morGet(`${morApiUrl}/billing/api/user_update?${params.toString()}`);
  let err = morResponseError(xml);
  if (
    err &&
    reseller.uniqueHash &&
    reseller.uniqueHash !== reseller.apiKey &&
    shouldTryAlternateAuth(xml, err)
  ) {
    params.set("hash", await sha1(`${morUserId}${reseller.apiKey}`));
    xml = await morGet(`${morApiUrl}/billing/api/user_update?${params.toString()}`);
    err = morResponseError(xml);
  }
  if (err) throw new Error(`MOR user_update name failed: ${err}`);
}

async function updateMorDeviceDescription(options: {
  morApiUrl: string;
  resellerUsername: string;
  reseller: { password: string; apiKey: string; uniqueHash: string };
  morUserId: string;
  morDeviceId: string;
  description: string;
}): Promise<void> {
  const { morApiUrl, resellerUsername, reseller, morUserId, morDeviceId, description } = options;
  const deviceHash = reseller.uniqueHash || await sha1(`${morUserId}${reseller.apiKey}`);
  const devicesParams = new URLSearchParams({
    u: resellerUsername,
    hash: deviceHash,
    user_id: morUserId,
    show_hidden_devices: "0",
  });
  if (reseller.password) devicesParams.set("p", reseller.password);

  const devicesXml = await morGet(`${morApiUrl}/billing/api/devices_get?${devicesParams.toString()}`);
  const block = morDeviceBlock(devicesXml, morDeviceId);
  if (!block) throw new Error(`MOR devices_get: device ${morDeviceId} was not found`);

  const usernameForHash = xmlTag(block, "username") || "";
  const authentication = xmlTag(block, "authentication") || "0";
  const host = xmlTag(block, "ipaddr") || xmlTag(block, "host") || "dynamic";
  const port = xmlTag(block, "port") || "5060";
  const updateHash = await sha1(
    `${morDeviceId}${authentication}${usernameForHash}${host}${port}${reseller.apiKey}`,
  );

  const updateParams = new URLSearchParams({
    u: resellerUsername,
    device: morDeviceId,
    authentication,
    username: usernameForHash,
    host,
    port,
    hash: updateHash,
    description,
    device_type: "SIP",
  });
  if (reseller.password) updateParams.set("p", reseller.password);

  const updateXml = await morGet(`${morApiUrl}/billing/api/device_update?${updateParams.toString()}`);
  const updateErr = morResponseError(updateXml);
  if (updateErr) throw new Error(`MOR device_update description failed: ${updateErr}`);
}

async function applyMorAccountLabels(options: {
  morApiUrl: string;
  resellerUsername: string;
  reseller: { password: string; apiKey: string; uniqueHash: string };
  morUserId: string;
  morDeviceId: string;
  businessName: string;
  agentName: string;
}): Promise<void> {
  const names = morUserNameParts(options.businessName);
  await updateMorUserDisplayName({
    morApiUrl: options.morApiUrl,
    resellerUsername: options.resellerUsername,
    reseller: options.reseller,
    morUserId: options.morUserId,
    firstName: names.first_name,
    lastName: names.last_name,
  });
  await updateMorDeviceDescription({
    morApiUrl: options.morApiUrl,
    resellerUsername: options.resellerUsername,
    reseller: options.reseller,
    morUserId: options.morUserId,
    morDeviceId: options.morDeviceId,
    description: morDeviceDescription(options.agentName),
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

serve(async (req) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-wisecall-provision-secret",
  };

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Internal only. This function provisions paid MOR resources and is called
    // from the Next.js server action, never directly from the browser.
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PROVISION_SECRET = Deno.env.get("WISECALL_PROVISION_SECRET")?.trim() ?? "";
    const PROVISION_SECRET_SHA256 =
      Deno.env.get("WISECALL_PROVISION_SECRET_SHA256")?.trim() ||
      "aaf533c44f417d85b4d813e30c046290a6ec444cc765cd5ee303e9c1d0dd7ed3";
    const authHeader = (req.headers.get("authorization") || "").trim();
    const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const providedKey = (req.headers.get("apikey") || bearerKey).trim();
    const providedProvisionSecret =
      (req.headers.get("x-wisecall-provision-secret") || "").trim();
    const provisionSecretMatches =
      Boolean(PROVISION_SECRET && providedProvisionSecret === PROVISION_SECRET) ||
      Boolean(
        providedProvisionSecret &&
          PROVISION_SECRET_SHA256 &&
          (await sha256(providedProvisionSecret)) === PROVISION_SECRET_SHA256,
      );
    if (
      providedKey !== SERVICE_ROLE_KEY &&
      !provisionSecretMatches
    ) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const action = String(body.action || "").trim();
    const profile_id = String(body.profile_id || "").trim();

    const MOR_API_URL = Deno.env.get("MOR_API_URL");
    const MOR_API_SECRET = Deno.env.get("MOR_API_SECRET");
    const MOR_UNIQUE_HASH = Deno.env.get("MOR_UNIQUE_HASH");
    const MOR_ADMIN_PASSWORD = Deno.env.get("MOR_API_PASSWORD") || "";
    const MOR_SIP_HOST = normalizeMorSipHost(
      Deno.env.get("MOR_SIP_DOMAIN") || (MOR_API_URL ? morSipDomain(MOR_API_URL) : ""),
    );
    // Owlnet reseller that owns the pooled DIDs (reseller_credentials.reseller_id).
    const MOR_RESELLER_ID = Deno.env.get("MOR_WISECALL_RESELLER_ID") || "7171";
    const MOR_RESELLER_USERNAME = Deno.env.get("MOR_WISECALL_RESELLER_USERNAME") || "";

    if (!MOR_API_URL || !MOR_API_SECRET || !MOR_UNIQUE_HASH) {
      throw new Error("MOR credentials not configured (MOR_API_URL / MOR_API_SECRET / MOR_UNIQUE_HASH)");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const reseller = await resolveResellerCredentials(
      supabase,
      MOR_RESELLER_ID,
      MOR_RESELLER_USERNAME,
    );
    const resellerUsername = reseller.username;
    const resellerOwnerId = reseller.uniqueHash || reseller.resellerId;
    console.log(`✅ Using MOR reseller ${resellerUsername} (${MOR_RESELLER_ID}) for provisioning`);

    if (action === "relabel_accounts") {
      if (providedKey !== SERVICE_ROLE_KEY) {
        return json({ ok: false, error: "Forbidden" }, 403);
      }
      const { data: liveProfiles, error: liveErr } = await supabase
        .from("wisecall_profiles")
        .select("id, business_name, clinic_name, receptionist_name, profile_name, metadata")
        .eq("is_active", true);
      if (liveErr) throw new Error(`relabel_accounts: ${liveErr.message}`);

      const results: Array<{ profile_id: string; ok: boolean; error?: string }> = [];
      for (const row of liveProfiles || []) {
        const routing = ((row.metadata as Record<string, unknown> | null)?.routing || {}) as Record<string, unknown>;
        const liveUserId = String(routing.morUserId || "");
        const liveDeviceId = String(routing.morDeviceId || "");
        if (!liveUserId || !liveDeviceId) continue;
        try {
          await applyMorAccountLabels({
            morApiUrl: MOR_API_URL,
            resellerUsername,
            reseller,
            morUserId: liveUserId,
            morDeviceId: liveDeviceId,
            businessName: profileBusinessName(row),
            agentName: profileAgentName(row),
          });
          results.push({ profile_id: row.id as string, ok: true });
        } catch (err) {
          results.push({
            profile_id: row.id as string,
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      return json({
        ok: results.every((row) => row.ok),
        action: "relabel_accounts",
        updated: results.filter((row) => row.ok).length,
        failed: results.filter((row) => !row.ok).length,
        results,
      });
    }

    if (!profile_id) return json({ ok: false, error: "profile_id required" }, 400);

    const { data: profileRow, error: profileReadErr } = await supabase
      .from("wisecall_profiles")
      .select("id, business_name, clinic_name, receptionist_name, profile_name, metadata")
      .eq("id", profile_id)
      .maybeSingle();
    if (profileReadErr) throw new Error(`wisecall_profiles read: ${profileReadErr.message}`);
    if (!profileRow) throw new Error(`Agent profile ${profile_id} not found`);

    const profileMetadata = (profileRow.metadata as Record<string, unknown> | null) ?? {};
    const ownerId = String(profileMetadata.owner_id || "");
    const businessName = profileBusinessName(profileRow);
    const agentName = profileAgentName(profileRow);
    const userNames = morUserNameParts(businessName);

    // Deterministic username per owner + business so a second Direct agent
    // reuses the same MOR user. Profile-id fallback keeps ownerless rows unique.
    const baseMorUsername = morUsernameForAccount({ ownerId, businessName, profileId: profile_id });
    let morUsername = baseMorUsername;

    // ── 0. Check for existing partial provisioning (idempotency) ──────────
    // If a previous attempt already reserved a DID and created MOR resources,
    // pick up from where it left off rather than creating a second user.
    const { data: existingPool } = await supabase
      .from("wisecall_mor_ddi_pool")
      .select("*")
      .eq("profile_id", profile_id)
      .in("status", ["reserved", "assigned"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    const { data: existingSip } = await supabase
      .from("wisecall_sip_endpoints")
      .select("sip_username, sip_password, mor_device_id, transport")
      .eq("profile_id", profile_id)
      .maybeSingle();

    let didPoolId = "";
    let didNumber = "";
    let morUserId = "";
    let morDeviceId = "";
    let deviceUsername = "";
    let sipPassword = "";

    if (existingPool?.mor_user_id && existingPool?.mor_device_id && existingSip?.sip_username) {
      // Full partial state available, skip user + device creation entirely.
      didPoolId = existingPool.id;
      didNumber = existingPool.did_number;
      morUserId = existingPool.mor_user_id;
      morDeviceId = existingPool.mor_device_id;
      deviceUsername = existingSip?.sip_username || morUsername;
      sipPassword = existingSip?.sip_password || generateSecret();
      console.log(`♻️ Resuming provisioning: DID ${didNumber} user ${morUserId} device ${morDeviceId}`);
    } else {
      if (existingPool?.id && existingPool?.did_number) {
        didPoolId = existingPool.id;
        didNumber = existingPool.did_number;
        console.log(`♻️ Reusing reserved DID ${didNumber}`);
      } else {
        // ── 1. Reserve a free DID ────────────────────────────────────────────
        // If already reserved for this profile, the SQL fn returns the existing row.
        const { data: didRows, error: didErr } = await supabase.rpc(
          "wisecall_reserve_mor_did",
          { p_profile_id: profile_id }
        );
        if (didErr) throw new Error(`DID reservation failed: ${didErr.message}`);
        const didRow = Array.isArray(didRows) ? didRows[0] : didRows;
        if (!didRow) throw new Error("No available MOR DIDs in pool, all 100 assigned");
        didPoolId = didRow.id;
        didNumber = didRow.did_number;
        console.log(`✅ Reserved DID ${didNumber} (pool id ${didPoolId})`);
      }

      sipPassword = generateSecret();
      const morPassword = generateSecret();

      const siblingQuery = ownerId
        ? await supabase
          .from("wisecall_profiles")
          .select("id, business_name, clinic_name, metadata")
          .eq("metadata->>owner_id", ownerId)
          .neq("id", profile_id)
        : { data: [] as Array<Record<string, unknown>>, error: null };
      if (siblingQuery.error) throw new Error(`sibling MOR lookup: ${siblingQuery.error.message}`);
      const reusedMorUserId = findReusableMorUserId(siblingQuery.data || [], {
        ownerId,
        businessName,
        profileId: profile_id,
      });

      // ── 2. Create or reuse MOR user (one per owner + business) ───────────
      if (reusedMorUserId) {
        morUserId = reusedMorUserId;
        console.log(`♻️ Reusing MOR user ${morUserId} for ${businessName}`);
      } else {
        if (existingPool?.id && existingPool?.did_number && !existingPool?.mor_user_id) {
          morUsername = `${baseMorUsername}r`;
          console.log(`♻️ Replacing partial MOR resources with reseller-owned ${morUsername}`);
        }
        const userParams = new URLSearchParams({
          u: resellerUsername,
          hash: reseller.uniqueHash || reseller.apiKey,
          username: morUsername,
          password: morPassword,
          password2: morPassword,
          first_name: userNames.first_name,
          last_name: userNames.last_name,
          email: `${morUsername}@wisecall.io`,
          device_type: "SIP",
          country_id: "80",
          id: resellerOwnerId,
          owner_id: resellerOwnerId,
        });
        if (reseller.password) userParams.set("p", reseller.password);

        const userXml = await morPost(`${MOR_API_URL}/billing/api/user_register`, userParams);
        console.log("MOR user_register response:", userXml.slice(0, 400));
        const userErr = morError(userXml);
        if (userErr) {
          if (/username.*taken|already.*taken/i.test(userErr)) {
            // User was created in a previous attempt, look up their ID from users_get.
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
          console.log(`✅ MOR user created: id=${morUserId} username=${morUsername} name=${businessName}`);
        }
      }

      // ── 3. Create SIP device under the user (one per agent) ──────────────
      const deviceHash = reseller.uniqueHash || await sha1(`${morUserId}${reseller.apiKey}`);
      const deviceParams = new URLSearchParams({
        u: resellerUsername,
        hash: deviceHash,
        user_id: morUserId,
        description: morDeviceDescription(agentName),
        type: "SIP",
        device_type: "SIP",
        authentication: "0",
        host: "dynamic",
        password: sipPassword,
      });
      if (reseller.password) deviceParams.set("p", reseller.password);

      const deviceXml = await morPost(`${MOR_API_URL}/billing/api/device_create`, deviceParams);
      console.log("MOR device_create response:", deviceXml.slice(0, 400));
      const deviceErr = morError(deviceXml);
      let deviceSourceXml = deviceXml;
      if (deviceErr) {
        // If this profile already had a device, look it up. Do not steal another
        // agent’s device when this is a second device on a shared MOR user.
        const knownDeviceId = existingPool?.mor_device_id || existingSip?.mor_device_id || "";
        console.warn(`⚠️ device_create error: ${deviceErr}, looking up existing device for user ${morUserId}`);
        const devicesParams = new URLSearchParams({
          u: resellerUsername,
          hash: deviceHash,
          user_id: morUserId,
          show_hidden_devices: "0",
        });
        if (reseller.password) devicesParams.set("p", reseller.password);
        const devicesXml = await morGet(
          `${MOR_API_URL}/billing/api/devices_get?${devicesParams.toString()}`
        );
        console.log("MOR devices_get response:", devicesXml.slice(0, 400));
        if (knownDeviceId) {
          morDeviceId = xmlTag(morDeviceBlock(devicesXml, knownDeviceId), "device_id")
            || xmlTag(morDeviceBlock(devicesXml, knownDeviceId), "id")
            || knownDeviceId;
          deviceSourceXml = devicesXml;
          console.log(`♻️ Found existing MOR device: id=${morDeviceId}`);
        } else {
          throw new Error(`MOR device_create failed: ${deviceErr}`);
        }
      } else {
        morDeviceId = xmlTag(deviceXml, "device_id") || xmlTag(deviceXml, "id") || "";
        if (!morDeviceId) throw new Error("MOR device_create: no device_id in response");
        console.log(`✅ MOR device created: id=${morDeviceId}`);
      }

      deviceUsername = xmlTag(morDeviceBlock(deviceSourceXml, morDeviceId), "username")
        || xmlTag(deviceSourceXml, "username")
        || xmlTag(deviceSourceXml, "name")
        || morUsername;

      // Save MOR IDs to pool now so retries can skip user/device creation.
      await supabase
        .from("wisecall_mor_ddi_pool")
        .update({ mor_user_id: morUserId, mor_device_id: morDeviceId })
        .eq("id", didPoolId);
    }

    // ── 4. Ensure MOR and Supabase hold the same SIP password ─────────────
    // MOR's device_create ignores `secret` for dynamic SIP devices and may
    // generate its own password. device_update uses `password`, plus a hash
    // that includes the device auth fields.
    deviceUsername = await syncMorDevicePassword({
      morApiUrl: MOR_API_URL,
      resellerUsername,
      reseller,
      morUserId,
      morDeviceId,
      deviceUsername,
      sipPassword,
    });
    console.log(`✅ MOR SIP password synced for device ${morDeviceId}`);

    try {
      await applyMorAccountLabels({
        morApiUrl: MOR_API_URL,
        resellerUsername,
        reseller,
        morUserId,
        morDeviceId,
        businessName,
        agentName,
      });
      console.log(`✅ MOR labels: user=${businessName} device=${agentName}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`⚠️ MOR label update failed (provisioning continues): ${message}`);
    }

    const apiSecret = MOR_API_SECRET.trim();
    const staleDidProfileId = "00000000-0000-0000-0000-000000000000";
    const lastDigits = (s: string) => s.replace(/\D/g, "").slice(-10);
    const didNotFree = (e: string | null) => !!e && /did.*not.*free|not.*free/i.test(e);

    // "Already assigned/reserved" means a previous attempt got this far, treat as
    // success and continue so the agent still gets marked live (idempotent retry).
    const alreadyDone = (e: string | null) =>
      !!e && /already.*(assigned|reserved)|is already/i.test(e);

    async function reserveNextPoolDid(reason: string): Promise<void> {
      console.warn(`⚠️ Quarantining MOR DID ${didNumber}: ${reason}`);
      await supabase
        .from("wisecall_mor_ddi_pool")
        .update({
          status: "reserved",
          profile_id: staleDidProfileId,
          mor_device_id: null,
          mor_user_id: null,
          assigned_at: null,
        })
        .eq("id", didPoolId);

      const { data: didRows, error: didErr } = await supabase.rpc(
        "wisecall_reserve_mor_did",
        { p_profile_id: profile_id },
      );
      if (didErr) throw new Error(`DID reservation failed after stale DID ${didNumber}: ${didErr.message}`);
      const didRow = Array.isArray(didRows) ? didRows[0] : didRows;
      if (!didRow) throw new Error("No available MOR DIDs in pool after skipping stale DID");
      didPoolId = didRow.id;
      didNumber = didRow.did_number;
      console.log(`✅ Retrying with DID ${didNumber} (pool id ${didPoolId})`);
    }

    let didXml = "";
    let didAssignErr: string | null = null;
    for (let didAttempt = 1; didAttempt <= 5; didAttempt += 1) {
      try {
        // ── 5a. Resolve the DID's internal id via dids_get ───────────────────
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
        // Fallback: single-row response, just grab the first numeric <id>.
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
        console.log(`✅ Using MOR reseller ${resellerUsername} (${MOR_RESELLER_ID}) for DID assignment`);

        // ── 5b. Reserve the DID to the reseller ─────────────────────────────
        const reserveHash = await sha1(`${didId}${apiSecret}`);
        const reserveXml = await morGet(
          `${MOR_API_URL}/billing/api/did_details_update?` +
          new URLSearchParams({ u: "admin", did_id: didId, did_user_id: MOR_RESELLER_ID, hash: reserveHash }),
        );
        console.log("MOR did_details_update (reserve→reseller) response:", reserveXml.slice(0, 200));

        const reserveErr = morResponseError(reserveXml);
        if (reserveErr && !alreadyDone(reserveErr)) {
          throw new Error(`MOR DID reserve to reseller failed: ${reserveErr}`);
        }

        // ── 5c. Assign the reseller-owned DID to the MOR user ───────────────
        const userReserveParams = new URLSearchParams({
          u: resellerUsername,
          did_id: didId,
          did_user_id: morUserId,
          hash: await sha1(`${didId}${reseller.apiKey}`),
        });
        if (reseller.password) userReserveParams.set("p", reseller.password);

        let userXml = await morGet(
          `${MOR_API_URL}/billing/api/did_details_update?${userReserveParams.toString()}`,
        );
        console.log("MOR did_details_update (reseller→user) response:", userXml.slice(0, 300));
        let userAssignErr = morResponseError(userXml);

        if (
          userAssignErr &&
          reseller.uniqueHash &&
          reseller.uniqueHash !== reseller.apiKey &&
          shouldTryAlternateAuth(userXml, userAssignErr)
        ) {
          userReserveParams.set("hash", reseller.uniqueHash);
          userXml = await morGet(
            `${MOR_API_URL}/billing/api/did_details_update?${userReserveParams.toString()}`,
          );
          console.log("MOR did_details_update (reseller→user unique hash) response:", userXml.slice(0, 300));
          userAssignErr = morResponseError(userXml);
        }

        if (userAssignErr && !alreadyDone(userAssignErr)) {
          throw new Error(`MOR DID user assign failed: ${userAssignErr}`);
        }

        await new Promise((resolve) => setTimeout(resolve, 2_000));

        // ── 5d. Bind the now-user-owned DID to the SIP device ───────────────
        async function assignDidToDeviceWithEndpoint(endpoint: string): Promise<{ xml: string; err: string | null }> {
          let lastXml = "";
          let lastErr: string | null = null;

          const attempts = [
            {
              label: "reseller unique hash",
              hash: reseller.uniqueHash,
              enabled: Boolean(reseller.uniqueHash),
            },
            {
              label: "did + device_id + reseller api key",
              hash: await sha1(`${didNumber}${morDeviceId}${reseller.apiKey}`),
              enabled: true,
            },
            {
              label: "device_id + did + reseller api key",
              hash: await sha1(`${morDeviceId}${didNumber}${reseller.apiKey}`),
              enabled: true,
            },
          ];

          for (const attempt of attempts) {
            if (!attempt.enabled) continue;
            const params = new URLSearchParams({
              u: resellerUsername,
              did: didNumber,
              device_id: morDeviceId,
              user_id: morUserId,
              hash: attempt.hash,
            });
            if (reseller.password) params.set("p", reseller.password);

            const xml = await morGet(
              `${MOR_API_URL}/billing/api/${endpoint}?${params.toString()}`,
            );
            lastXml = xml;
            lastErr = morResponseError(xml);
            if (!lastErr) return { xml, err: null };
            if (!shouldTryAlternateAuth(xml, lastErr)) return { xml, err: lastErr };
            console.log(`⚠️ ${endpoint} failed with ${attempt.label}; trying alternate auth/hash pattern`);
          }

          return { xml: lastXml, err: lastErr };
        }

        async function assignDidToDevice(endpoint: string): Promise<string> {
          let result = await assignDidToDeviceWithEndpoint(endpoint);
          if (result.err && endpoint === "did_device_assign" && /trunk|not.*free/i.test(result.err)) {
            console.log("⚠️ SIP device assignment failed; retrying with did_trunk_device_assign");
            result = await assignDidToDeviceWithEndpoint("did_trunk_device_assign");
          }
          if (result.err && !alreadyDone(result.err)) {
            throw new Error(`MOR DID device assign failed: ${result.err}`);
          }
          return result.xml;
        }

        didXml = await assignDidToDevice("did_device_assign");
        didAssignErr = morResponseError(didXml);
        if (didAssignErr && alreadyDone(didAssignErr)) didAssignErr = null;
        break;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (didNotFree(message) && didAttempt < 5) {
          await reserveNextPoolDid(message);
          continue;
        }
        throw err;
      }
    }

    if (!didXml || didAssignErr) {
      throw new Error(`MOR DID device assign failed: ${didAssignErr || "unknown MOR error"}`);
    }
    console.log("MOR device assign response:", didXml.slice(0, 200));
    console.log(`✅ DID ${didNumber} bound to user ${morUserId} / device ${morDeviceId}`);

    // ── 6. Upsert wisecall_sip_endpoints (bridge auto-picks it up in ~30s) ─
    const morTransport = String(existingSip?.transport || "udp").toLowerCase();
    const morSignalingPort = morTransport === "tls" ? 5061 : 5060;
    const morSipProxy = `${MOR_SIP_HOST}:${morSignalingPort}`;
    const sipEndpointRow: Record<string, unknown> = {
      profile_id,
      pbx_type: "mor",
      sip_username: deviceUsername,
      sip_password: sipPassword,
      sip_domain: MOR_SIP_HOST,
      sip_proxy: morSipProxy,
      is_enabled: true,
      mor_device_id: morDeviceId,
    };
    // Keep transport if the customer already switched to TLS/TCP in the portal —
    // reprovisioning must not silently reset them back to UDP.
    if (!existingSip?.transport) {
      sipEndpointRow.transport = "udp";
    }
    const { error: sipErr } = await supabase.from("wisecall_sip_endpoints").upsert(
      sipEndpointRow,
      { onConflict: "profile_id" },
    );
    if (sipErr) throw new Error(`wisecall_sip_endpoints upsert: ${sipErr.message}`);
    console.log(`✅ SIP endpoint upserted: ${deviceUsername}@${MOR_SIP_HOST}`);

    // ── 7. Update agent profile: routing + number ─────────────────────────
    const metadata = profileMetadata;
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
