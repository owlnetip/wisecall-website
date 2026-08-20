// Checks the Telnyx voice edge (WISECALL_EDGE_BASE_URL) and, when authorised,
// can start or reboot the EC2 instance that hosts it.
//
// Auth: x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET, or service-role key.

import {
  AssociateAddressCommand,
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  EC2Client,
  RebootInstancesCommand,
  StartInstancesCommand,
} from "npm:@aws-sdk/client-ec2@3";

const DEFAULT_EDGE_PUBLIC_IP = "13.40.127.21";
const LIVE_EDGE_BASE_URL = "https://18.132.149.25.sslip.io";
const DEFAULT_TEXML_APP_IDS = [
  "2941088157250094723",
  "2980953819380188229",
  "2985822410638362142",
];

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trigger-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function probeEdge(baseUrl: string, timeoutMs = 8000) {
  const healthUrl = new URL("/health", baseUrl.replace(/\/+$/, ""));
  const started = Date.now();
  try {
    const response = await fetch(healthUrl.toString(), {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text().catch(() => "");
    return {
      ok: response.ok,
      status: response.status,
      latency_ms: Date.now() - started,
      body: text.slice(0, 200),
      url: healthUrl.toString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
      url: healthUrl.toString(),
    };
  }
}

async function ensureElasticIp(instanceId: string, edgeIp: string) {
  const client = ec2Client();
  const addresses = await client.send(new DescribeAddressesCommand({
    PublicIps: [edgeIp],
  }));
  const allocation = addresses.Addresses?.[0];
  if (!allocation?.AllocationId) {
    return { ok: false, reason: `No Elastic IP allocation found for ${edgeIp}` };
  }
  if (allocation.InstanceId === instanceId) {
    return { ok: true, action: "already_associated", public_ip: edgeIp };
  }
  await client.send(new AssociateAddressCommand({
    AllocationId: allocation.AllocationId,
    InstanceId: instanceId,
  }));
  return { ok: true, action: "associated", public_ip: edgeIp, instance_id: instanceId };
}

async function listElasticIps() {
  const client = ec2Client();
  const addresses = await client.send(new DescribeAddressesCommand({}));
  return (addresses.Addresses ?? []).map((allocation) => ({
    public_ip: allocation.PublicIp ?? null,
    instance_id: allocation.InstanceId ?? null,
    domain: allocation.Domain ?? null,
  }));
}

function ec2Client() {
  const accessKey = Deno.env.get("BICOM_S3_ACCESS_KEY")?.trim();
  const secretKey = Deno.env.get("BICOM_S3_SECRET_KEY")?.trim();
  const region = Deno.env.get("BICOM_S3_REGION")?.trim() || "eu-west-2";
  if (!accessKey || !secretKey) {
    throw new Error("BICOM S3/AWS credentials not configured");
  }
  return new EC2Client({
    region,
    credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
  });
}

async function listInstances() {
  const client = ec2Client();
  const response = await client.send(new DescribeInstancesCommand({}));
  return (response.Reservations ?? []).flatMap((reservation) =>
    (reservation.Instances ?? []).map((instance) => ({
      instance_id: instance.InstanceId ?? null,
      state: instance.State?.Name ?? "unknown",
      public_ip: instance.PublicIpAddress ?? null,
      private_ip: instance.PrivateIpAddress ?? null,
      name: (instance.Tags ?? []).find((tag) => tag.Key === "Name")?.Value ?? null,
    }))
  );
}

async function findEdgeInstance(edgeIp: string) {
  const instances = await listInstances();
  return instances.find((instance) => instance.public_ip === edgeIp) ?? null;
}

async function retargetTexmlApps(
  telnyxKey: string,
  apps: { id: string; voice_url?: string | null }[],
  healthyBaseUrl: string,
) {
  const results = [];
  const nextVoiceUrl = `${healthyBaseUrl.replace(/\/+$/, "")}/telnyx/texml`;
  for (const app of apps) {
    const current = String(app.voice_url || "");
    if (
      !current.includes("13.40.127.21") &&
      !current.includes("18.171.233.209")
    ) {
      results.push({ id: app.id, action: "unchanged", voice_url: current || null });
      continue;
    }
    const response = await fetch(`https://api.telnyx.com/v2/texml_applications/${app.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${telnyxKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        voice_url: nextVoiceUrl,
        voice_method: "POST",
      }),
      signal: AbortSignal.timeout(8000),
    });
    const payload = await response.json().catch(() => ({})) as { data?: { voice_url?: string } };
    results.push({
      id: app.id,
      action: response.ok ? "updated" : "failed",
      http_status: response.status,
      previous_voice_url: current,
      voice_url: payload.data?.voice_url ?? nextVoiceUrl,
    });
  }
  return results;
}

async function inspectTexmlApps() {
  const telnyxKey = Deno.env.get("TELNYX_API_KEY")?.trim();
  if (!telnyxKey) return { error: "TELNYX_API_KEY not set" };

  const configured = Deno.env.get("WISECALL_TEXML_APPLICATION_SID")?.trim();
  const ids = [...new Set([configured, ...DEFAULT_TEXML_APP_IDS].filter(Boolean) as string[])];
  const apps = [];
  for (const id of ids) {
    try {
      const response = await fetch(`https://api.telnyx.com/v2/texml_applications/${id}`, {
        headers: {
          Authorization: `Bearer ${telnyxKey}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(8000),
      });
      const payload = await response.json().catch(() => ({})) as {
        data?: Record<string, unknown>;
        errors?: unknown;
      };
      const data = payload.data ?? {};
      apps.push({
        id,
        http_status: response.status,
        friendly_name: data.friendly_name ?? data.friendlyName ?? null,
        voice_url: data.voice_url ?? data.voiceUrl ?? null,
        voice_method: data.voice_method ?? data.voiceMethod ?? null,
      });
    } catch (error) {
      apps.push({
        id,
        http_status: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { apps };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const expected = Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") || "";
  const provided = req.headers.get("x-trigger-secret") || "";
  const authHeader = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || apikey.trim();
  const authorised =
    (expected && provided === expected) ||
    (serviceRole && token === serviceRole);
  if (!authorised) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let recover = false;
  try {
    const body = await req.json().catch(() => ({}));
    recover = Boolean((body as { recover?: boolean }).recover);
  } catch {
    recover = false;
  }

  const edgeBaseUrl = Deno.env.get("WISECALL_EDGE_BASE_URL")?.trim() || "";
  const edgeIp = Deno.env.get("WISECALL_EDGE_PUBLIC_IP")?.trim() || DEFAULT_EDGE_PUBLIC_IP;
  const liveHealth = await probeEdge(LIVE_EDGE_BASE_URL);
  const health = edgeBaseUrl
    ? await probeEdge(edgeBaseUrl)
    : { ok: false, error: "WISECALL_EDGE_BASE_URL not set" };
  const historicalHealth = await probeEdge(`https://${edgeIp}.sslip.io`, 4000);
  const healthyBaseUrl = liveHealth.ok
    ? LIVE_EDGE_BASE_URL
    : historicalHealth.ok
    ? `https://${edgeIp}.sslip.io`
    : health.ok
    ? edgeBaseUrl
    : "";

  let instance: Awaited<ReturnType<typeof findEdgeInstance>> = null;
  let allInstances: Awaited<ReturnType<typeof listInstances>> = [];
  let elasticIps: Awaited<ReturnType<typeof listElasticIps>> = [];
  let recovery: Record<string, unknown> | null = null;
  const texmlApps = await inspectTexmlApps();

  try {
    allInstances = await listInstances();
    elasticIps = await listElasticIps().catch(() => []);
    instance = allInstances.find((item) => item.public_ip === edgeIp) ?? null;
    if (!instance) {
      const nameMatch = allInstances.find((item) =>
        /wisecall|telnyx|voice|edge/i.test(item.name ?? "")
      );
      if (nameMatch) instance = nameMatch;
    }
  } catch (error) {
    return json({
      ok: false,
      edge_base_url: edgeBaseUrl || null,
      edge_ip: edgeIp,
      health,
      historical_health: historicalHealth,
      texml_apps: texmlApps,
      aws_error: error instanceof Error ? error.message : String(error),
    }, 500);
  }

  if (recover) {
    if (healthyBaseUrl) {
      const telnyxKey = Deno.env.get("TELNYX_API_KEY")?.trim() || "";
      const apps = Array.isArray((texmlApps as { apps?: { id: string; voice_url?: string | null }[] }).apps)
        ? (texmlApps as { apps: { id: string; voice_url?: string | null }[] }).apps
        : [];
      const retarget = telnyxKey
        ? await retargetTexmlApps(telnyxKey, apps, healthyBaseUrl)
        : { error: "TELNYX_API_KEY not set" };
      recovery = {
        action: "retarget_texml",
        healthy_edge: healthyBaseUrl,
        skipped_ec2_reboot: true,
        reason: "Live media edge is healthy; BICOM instance is the PBX, not /media.",
        texml_retarget: retarget,
      };
    } else {
      recovery = { action: "none", reason: "No healthy media edge and no EC2 host to recover" };
    }
  }

  const finalHealth = liveHealth.ok ? liveHealth : health.ok ? health : historicalHealth;
  const healthy = Boolean(finalHealth.ok);
  return json({
    ok: healthy,
    edge_base_url: edgeBaseUrl || null,
    live_edge_base_url: LIVE_EDGE_BASE_URL,
    edge_ip: edgeIp,
    health: finalHealth,
    configured_health: health,
    live_health: liveHealth,
    historical_health: historicalHealth,
    instance,
    all_instances: allInstances.slice(0, 20),
    elastic_ips: elasticIps.slice(0, 20),
    texml_apps: texmlApps,
    recovery,
    message: healthy
      ? "Telnyx edge is responding."
      : recovery
      ? "Recovery action queued; wait ~60s and re-check /health."
      : "Telnyx edge is not responding. POST with {\"recover\": true} to reboot/start the EC2 host.",
  }, healthy ? 200 : 503);
});
