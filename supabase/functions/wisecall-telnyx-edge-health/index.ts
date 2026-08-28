// Checks the Telnyx voice edge (WISECALL_EDGE_BASE_URL) and, when authorised,
// can start or reboot the EC2 instance that hosts it.
//
// Auth: x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET (same as pool replenish).

import {
  AssociateAddressCommand,
  DescribeAddressesCommand,
  DescribeInstancesCommand,
  EC2Client,
  RebootInstancesCommand,
  StartInstancesCommand,
} from "npm:@aws-sdk/client-ec2@3";
import { probeEdgeHealth as sharedProbeEdgeHealth } from "../_shared/texml.ts";

const DEFAULT_EDGE_PUBLIC_IP = "13.40.127.21";

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

async function probeEdge(baseUrl: string) {
  const healthUrl = new URL("/health", baseUrl.replace(/\/+$/, ""));
  const result = await sharedProbeEdgeHealth(baseUrl);
  return {
    ...result,
    url: healthUrl.toString(),
  };
}

async function listElasticIps() {
  const client = ec2Client();
  const addresses = await client.send(new DescribeAddressesCommand({}));
  return (addresses.Addresses ?? []).map((address) => ({
    public_ip: address.PublicIp ?? null,
    allocation_id: address.AllocationId ?? null,
    instance_id: address.InstanceId ?? null,
  }));
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
  const health = edgeBaseUrl ? await probeEdge(edgeBaseUrl) : { ok: false, error: "WISECALL_EDGE_BASE_URL not set" };

  let instance: Awaited<ReturnType<typeof findEdgeInstance>> = null;
  let allInstances: Awaited<ReturnType<typeof listInstances>> = [];
  let recovery: Record<string, unknown> | null = null;

  try {
    allInstances = await listInstances();
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
      aws_error: error instanceof Error ? error.message : String(error),
    }, 500);
  }

  if (recover) {
    const target =
      instance ??
      allInstances.find((item) => item.state === "running") ??
      allInstances.find((item) => item.state === "stopped") ??
      allInstances.find((item) => /wisecall|telnyx|voice|edge/i.test(item.name ?? ""));

    if (target?.instance_id) {
      const client = ec2Client();
      if (target.state === "stopped") {
        await client.send(new StartInstancesCommand({ InstanceIds: [target.instance_id] }));
        recovery = { action: "start", instance_id: target.instance_id, previous_state: target.state };
        instance = target;
        await new Promise((resolve) => setTimeout(resolve, 15000));
      } else if (target.state === "running" && target.public_ip !== edgeIp) {
        recovery = { action: "associate_elastic_ip", instance_id: target.instance_id, previous_state: target.state };
        instance = target;
      } else if (target.state === "running") {
        await client.send(new RebootInstancesCommand({ InstanceIds: [target.instance_id] }));
        recovery = { action: "reboot", instance_id: target.instance_id, previous_state: target.state };
        instance = target;
      } else {
        recovery = { action: "none", reason: `Instance state is ${target.state}`, instance_id: target.instance_id };
        instance = target;
      }

      if (target.instance_id) {
        const eip = await ensureElasticIp(target.instance_id, edgeIp).catch((error) => ({
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
        }));
        recovery = { ...(recovery ?? {}), elastic_ip: eip };
      }
    } else {
      recovery = { action: "none", reason: "No EC2 instance found to recover" };
    }
  }

  const healthAfterRecovery = recovery ? await probeEdge(edgeBaseUrl || `https://${edgeIp}.sslip.io`) : health;
  const finalHealth = recovery ? healthAfterRecovery : health;
  const healthy = Boolean(finalHealth.ok);
  return json({
    ok: healthy,
    edge_base_url: edgeBaseUrl || null,
    edge_ip: edgeIp,
    health: finalHealth,
    instance,
    all_instances: allInstances.slice(0, 20),
    elastic_ips: recover ? await listElasticIps().catch(() => []) : undefined,
    recovery,
    message: healthy
      ? "Telnyx edge is responding."
      : recovery
      ? "Recovery action queued; wait ~60s and re-check /health. If /health stays 404, run wisecall-telnyx-app-sync to route Telnyx via MOR SIP fallback."
      : "Telnyx edge is not responding. POST wisecall-telnyx-app-sync to route calls via MOR SIP, or POST here with {\"recover\": true} to reboot/start the EC2 host.",
    remediation: healthy
      ? null
      : {
          app_sync:
            "POST /functions/v1/wisecall-telnyx-app-sync with x-trigger-secret to point Telnyx voice_url at wisecall-telnyx-inbound (MOR fallback when edge is down).",
          edge_recover:
            "POST /functions/v1/wisecall-telnyx-edge-health with {\"recover\": true} to start/reboot EC2.",
        },
  }, healthy ? 200 : 503);
});
