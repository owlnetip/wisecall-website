import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return xmlTag(xml, "error") || xmlTag(xml, "e") ||
    (/access denied/i.test(xml) ? "Access Denied" : null);
}

async function morGet(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`MOR HTTP ${res.status}: ${res.statusText}`);
  return res.text();
}

function lastDigits(value: string): string {
  return value.replace(/\D/g, "").slice(-10);
}

function findDidRow(xml: string, didNumber: string): { didId: string; rowXml: string } {
  const wantTail = lastDigits(didNumber);
  const rowRegex = /<did>\s*<did>([^<]*)<\/did>([\s\S]*?)<\/did>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRegex.exec(xml)) !== null) {
    if (lastDigits(m[1]) === wantTail) {
      return { didId: xmlTag(m[2], "id") || xmlTag(m[2], "did_id") || "", rowXml: m[2] };
    }
  }

  if (wantTail && xml.includes(didNumber)) {
    return { didId: xmlTag(xml, "id") || xmlTag(xml, "did_id") || "", rowXml: xml };
  }

  return { didId: "", rowXml: "" };
}

function morLoginUsername(username: string): string {
  return username.trim().replace(/ /g, "_");
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

  if (error) throw new Error(`Failed to look up MOR reseller ${resellerId}: ${error.message}`);
  if (!data?.reseller_id) throw new Error(`No active MOR reseller credentials for ${resellerId}`);

  const apiKey = String(data.api_key || data.unique_hash || "").trim();
  const uniqueHash = String(data.unique_hash || "").trim();
  if (!apiKey && !uniqueHash) throw new Error(`MOR reseller ${resellerId} has no API key`);

  return {
    resellerId: String(data.reseller_id),
    username: morLoginUsername(configuredUsername.trim() || data.reseller_name || resellerId),
    password: String(data.password || "").trim(),
    apiKey: apiKey || uniqueHash,
    uniqueHash,
  };
}

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
    if (providedKey !== SERVICE_ROLE_KEY && !provisionSecretMatches) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const { profile_id } = await req.json();
    if (!profile_id) return json({ ok: false, error: "profile_id required" }, 400);

    const MOR_API_URL = Deno.env.get("MOR_API_URL");
    const MOR_API_SECRET = Deno.env.get("MOR_API_SECRET");
    const MOR_UNIQUE_HASH = Deno.env.get("MOR_UNIQUE_HASH");
    const MOR_RESELLER_ID = Deno.env.get("MOR_WISECALL_RESELLER_ID") || "7171";
    const MOR_RESELLER_USERNAME = Deno.env.get("MOR_WISECALL_RESELLER_USERNAME") || "";
    if (!MOR_API_URL || !MOR_API_SECRET || !MOR_UNIQUE_HASH) {
      throw new Error("MOR credentials not configured");
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: poolRow, error: poolError } = await supabase
      .from("wisecall_mor_ddi_pool")
      .select("id, did_number, status, profile_id, mor_device_id, mor_user_id")
      .eq("profile_id", profile_id)
      .in("status", ["reserved", "assigned"])
      .maybeSingle();

    if (poolError) throw new Error(`MOR DDI pool lookup failed: ${poolError.message}`);
    if (!poolRow) return json({ ok: true, releasedNumber: null, warnings: [] });

    const warnings: string[] = [];
    const didNumber = String(poolRow.did_number || "");
    const reseller = await resolveResellerCredentials(
      supabase,
      MOR_RESELLER_ID,
      MOR_RESELLER_USERNAME,
    );

    let didId = "";
    try {
      const didsXml = await morGet(
        `${MOR_API_URL}/billing/api/dids_get?` +
          new URLSearchParams({
            u: "admin",
            s_user: "all",
            s_call_type: "all",
            s_device: "all",
            s_reseller: "all",
            search_did_number: didNumber,
            hash: MOR_UNIQUE_HASH.trim(),
          }),
      );
      didId = findDidRow(didsXml, didNumber).didId;
    } catch (err) {
      warnings.push(`MOR DID lookup failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (didId) {
      // Free the DID by setting did_user_id = -1 (MOR's "make DID free"), which
      // detaches it from the agent's user and its device, returning it to the
      // reseller's free pool. This MUST run as the reseller that owns the DID —
      // admin gets "Access Denied"/"already assigned" on a reseller-owned DID,
      // the same reason provisioning runs under the reseller. Hash is
      // sha1(did_id + secret), the exact reverse of the provisioning reserve.
      // (There is no reliable dedicated did_unassign_device method; per the
      // Kolmisoft wiki, did_details_update did_user_id=-1 is the way to free.)
      try {
        const freeHash = await sha1(`${didId}${MOR_API_SECRET.trim()}`);
        const params = new URLSearchParams({
          u: reseller.username,
          did_id: didId,
          did_user_id: "-1",
          hash: freeHash,
        });
        if (reseller.password) params.set("p", reseller.password);
        const xml = await morGet(
          `${MOR_API_URL}/billing/api/did_details_update?${params.toString()}`,
        );
        const err = morError(xml);
        if (err && !/not assigned|already|free/i.test(err)) {
          warnings.push(`MOR did_details_update (free DID): ${err}`);
        }
      } catch (err) {
        warnings.push(
          `MOR did_details_update (free DID): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } else {
      warnings.push(`Could not resolve MOR DID id for ${didNumber}; local pool release only`);
    }

    const { error: releaseError } = await supabase
      .from("wisecall_mor_ddi_pool")
      .update({
        status: "available",
        profile_id: null,
        mor_device_id: null,
        mor_user_id: null,
        assigned_at: null,
      })
      .eq("id", poolRow.id);

    if (releaseError) throw new Error(`MOR DDI pool release failed: ${releaseError.message}`);

    return json({ ok: true, releasedNumber: didNumber, warnings });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("MOR release failed:", message);
    return json({ ok: false, error: message }, 500);
  }
});
