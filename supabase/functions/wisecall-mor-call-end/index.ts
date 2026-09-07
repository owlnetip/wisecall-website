// wisecall-mor-call-end — MOR SIP equivalent of Telnyx post-transfer recording.
//
// Telnyx Call Control keeps recording after a mobile transfer, so hangup already
// has the full transcript. MOR SIP REFER drops the WiseCall bridge from media,
// so live STT stops. MOR can keep recording the SIP device; this webhook runs
// when that call ends, fetches recordings_get, transcribes, merges onto
// wisecall_call_logs, then fires the same email + AI summary path.
//
// MOR GUI (required for audio): Users → Devices → the agent's SIP device →
// Record calls for this Device = Yes. Also allow recording on the user/reseller
// if the Recordings addon asks for it. Home Cloud and Source Investments use
// MOR SIP — turn it on those devices (and the WiseCall default device template
// so new agents inherit it). Provisioning writes webhook_url_for_call_end here.
//
// MOR delivers Call End as POST with an empty body and query parameters.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  formatDeepgramTranscript,
  mergeLiveAndRecordingTranscript,
  parseMorCallEndParams,
  parseMorRecordingsXml,
  pickMorRecording,
  selectMatchingCallLog,
  withAttachedRecordingMetadata,
  type MorCallEndEvent,
  type MorRecording,
} from "../_shared/mor-transfer-recording.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function acceptedSecrets(): string[] {
  return [
    Deno.env.get("WISECALL_MOR_CALL_END_SECRET"),
    Deno.env.get("WISECALL_WEBHOOK_SECRET"),
    Deno.env.get("WISECALL_PROVISION_SECRET"),
    Deno.env.get("WISECALL_EMAIL_WEBHOOK_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function authorised(req: Request, eventToken: string): boolean {
  const provided =
    eventToken ||
    req.headers.get("x-wisecall-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("apikey") ||
    "";
  const accepted = acceptedSecrets();
  return Boolean(provided) && accepted.includes(provided);
}

async function sha1(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function fetchMorRecordings(event: MorCallEndEvent): Promise<MorRecording[]> {
  const morApiUrl = (Deno.env.get("MOR_API_URL") || "").replace(/\/+$/, "");
  const uniqueHash = (Deno.env.get("MOR_UNIQUE_HASH") || "").trim();
  const apiSecret = (Deno.env.get("MOR_API_SECRET") || "").trim();
  const adminPassword = Deno.env.get("MOR_API_PASSWORD") || "";
  if (!morApiUrl || (!uniqueHash && !apiSecret)) return [];

  const hashes = [uniqueHash, apiSecret ? await sha1(apiSecret) : ""].filter(Boolean);
  const dateFrom = Math.floor((Date.now() - 6 * 60 * 60 * 1000) / 1000);
  const dateTill = Math.floor((Date.now() + 60 * 1000) / 1000);

  for (const hash of hashes) {
    const params = new URLSearchParams({
      u: "admin",
      hash,
      date_from: String(dateFrom),
      date_till: String(dateTill),
    });
    if (adminPassword) params.set("p", adminPassword);
    if (event.uniqueid) params.set("uniqueid", event.uniqueid);
    else if (event.deviceId) params.set("device", event.deviceId);
    if (event.src) params.set("source", event.src);
    if (event.dst) params.set("destination", event.dst);

    try {
      const res = await fetch(`${morApiUrl}/billing/api/recordings_get?${params.toString()}`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) continue;
      const xml = await res.text();
      if (/<error>/i.test(xml) && /incorrect hash|access denied/i.test(xml)) continue;
      const rows = parseMorRecordingsXml(xml);
      if (rows.length) return rows;
    } catch (err) {
      console.error("wisecall-mor-call-end recordings_get:", err instanceof Error ? err.message : err);
    }
  }
  return [];
}

async function transcribeRecording(mp3Url: string): Promise<string> {
  const key = (Deno.env.get("DEEPGRAM_API_KEY") || "").trim();
  if (!key || !mp3Url) return "";
  const res = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&diarize=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ url: mp3Url }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!res.ok) {
    console.error("wisecall-mor-call-end deepgram:", res.status, await res.text().catch(() => ""));
    return "";
  }
  return formatDeepgramTranscript(await res.json());
}

async function triggerPortalAnalysis(callLogId: string): Promise<void> {
  const secret = (
    Deno.env.get("WISECALL_WEBHOOK_SECRET") ||
    Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET") ||
    ""
  ).trim();
  const portal = (
    Deno.env.get("WISECALL_PORTAL_URL") ||
    Deno.env.get("PORTAL_URL") ||
    Deno.env.get("SITE_URL") ||
    "https://wisecall.io"
  ).replace(/\/+$/, "");
  if (!secret || !callLogId) return;
  await fetch(`${portal}/api/webhooks/call-completed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wisecall-secret": secret,
    },
    body: JSON.stringify({ call_id: callLogId }),
    signal: AbortSignal.timeout(15_000),
  }).catch((err) => {
    console.error("wisecall-mor-call-end portal analysis:", err instanceof Error ? err.message : err);
  });
}

async function triggerEmailSummary(opts: {
  profile: Record<string, unknown>;
  callId: string;
  callerId: string;
  transcript: string;
  summary: string;
  outcome: string;
  startedAt: string;
}): Promise<void> {
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const secret = (
    Deno.env.get("WISECALL_EMAIL_WEBHOOK_SECRET") ||
    Deno.env.get("WISECALL_WEBHOOK_SECRET") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    ""
  ).trim();
  if (!supabaseUrl || !secret) return;
  await fetch(`${supabaseUrl}/functions/v1/wisecall-email-summary`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-wisecall-secret": secret,
    },
    body: JSON.stringify({
      profile: {
        id: opts.profile.id,
        slug: opts.profile.slug,
        profile_name: opts.profile.profile_name,
        business_name: opts.profile.business_name || opts.profile.clinic_name,
      },
      session: {
        call_id: opts.callId,
        caller_id: opts.callerId,
        started_at: opts.startedAt,
      },
      extra: {
        summary: opts.summary,
        transcript: opts.transcript,
        reason: opts.outcome,
      },
    }),
    signal: AbortSignal.timeout(10_000),
  }).catch((err) => {
    console.error("wisecall-mor-call-end email summary:", err instanceof Error ? err.message : err);
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST" && req.method !== "GET") return json({ error: "Method not allowed" }, 405);

  const url = new URL(req.url);
  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const parsed = await req.json();
        if (isPlainObject(parsed)) body = parsed;
      } catch {
        body = {};
      }
    }
  }

  const event = parseMorCallEndParams({
    ...Object.fromEntries(url.searchParams.entries()),
    ...body,
  });
  if (!authorised(req, event.token)) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase not configured" }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  let profileId = String(body.profile_id || "").trim();
  let endpointId: string | null = null;
  if (!profileId && event.deviceId) {
    const { data: endpoint } = await supabase
      .from("wisecall_sip_endpoints")
      .select("id, profile_id")
      .eq("mor_device_id", event.deviceId)
      .maybeSingle();
    profileId = String(endpoint?.profile_id || "");
    endpointId = endpoint?.id ? String(endpoint.id) : null;
  }

  const explicitCallLogId = String(body.call_id || body.call_log_id || "").trim();
  let log: {
    id: string;
    call_id: string | null;
    profile_id: string | null;
    profile_name: string | null;
    caller_id: string | null;
    summary: string | null;
    transcript: string | null;
    outcome: string | null;
    started_at: string | null;
    finished_at: string | null;
    metadata: Record<string, unknown> | null;
    recording_url: string | null;
  } | null = null;

  if (explicitCallLogId) {
    const { data } = await supabase
      .from("wisecall_call_logs")
      .select(
        "id, call_id, profile_id, profile_name, caller_id, summary, transcript, outcome, started_at, finished_at, metadata, recording_url",
      )
      .eq("id", explicitCallLogId)
      .maybeSingle();
    log = data;
    if (log?.profile_id) profileId = log.profile_id;
  } else if (profileId) {
    const { data: logs } = await supabase
      .from("wisecall_call_logs")
      .select(
        "id, call_id, profile_id, profile_name, caller_id, summary, transcript, outcome, started_at, finished_at, metadata, recording_url, sip_call_id, created_at",
      )
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(20);
    const match = selectMatchingCallLog(logs ?? [], event);
    if (match) {
      log = (logs ?? []).find((row) => row.id === match.id) ?? null;
    }
  }

  if (!log) {
    return json({ ok: true, skipped: "no_matching_call" });
  }

  const providedUrl = String(body.recording_url || "").trim();
  const providedTranscript = String(body.recording_transcript || "").trim();
  let recording = providedUrl
    ? {
        id: null,
        userId: null,
        srcDeviceId: event.deviceId || null,
        dstDeviceId: null,
        date: null,
        durationSec: Number(body.recording_duration_sec || 0) || 0,
        source: event.src || null,
        destination: event.dst || null,
        uniqueid: event.uniqueid || null,
        size: 0,
        mp3Url: providedUrl,
      }
    : null;

  if (!providedTranscript && !recording) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const rows = await fetchMorRecordings(event);
      recording = pickMorRecording(rows, event);
      if (recording?.mp3Url) break;
      await sleep(4000);
    }
  }

  const recordingTranscript =
    providedTranscript || (recording?.mp3Url ? await transcribeRecording(recording.mp3Url) : "");
  const merged = mergeLiveAndRecordingTranscript(log.transcript, recordingTranscript);
  const metadata = withAttachedRecordingMetadata(log.metadata, {
    mor_recording_id: recording?.id,
    mor_uniqueid: event.uniqueid || recording?.uniqueid,
    recording_source: providedTranscript || providedUrl ? "host" : "mor",
    endpoint_id: endpointId,
  });

  const { error: updateError } = await supabase
    .from("wisecall_call_logs")
    .update({
      transcript: merged,
      recording_url: recording?.mp3Url || log.recording_url,
      recording_duration_sec: recording?.durationSec || null,
      sip_call_id: event.uniqueid || recording?.uniqueid || null,
      pbx_type: "mor",
      metadata,
      finished_at: log.finished_at,
    })
    .eq("id", log.id);
  if (updateError) {
    console.error("wisecall-mor-call-end update:", updateError.message);
    return json({ ok: false, error: updateError.message }, 500);
  }

  const { data: profile } = log.profile_id
    ? await supabase
        .from("wisecall_profiles")
        .select("id, slug, profile_name, business_name, clinic_name, metadata")
        .eq("id", log.profile_id)
        .maybeSingle()
    : { data: null };

  if (profile) {
    await triggerEmailSummary({
      profile,
      callId: log.call_id || "",
      callerId: log.caller_id || event.src || "Unknown",
      transcript: merged,
      summary: log.summary || "",
      outcome: log.outcome || "transfer",
      startedAt: log.started_at || "",
    });
  }
  await triggerPortalAnalysis(log.id);

  return json({
    ok: true,
    call_log_id: log.id,
    recording: Boolean(recording?.mp3Url),
    transcribed: Boolean(recordingTranscript),
    deferred_complete: true,
  });
});
