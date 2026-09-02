import { NextResponse } from "next/server";
import {
  extractLeadgenChanges,
  extractUkMobileFromFieldData,
  fetchGraphLead,
  getMetaAppSecret,
  getMetaPageAccessToken,
  getMetaVerifyToken,
  META_LEADGEN_SOURCE,
  metaHubChallengeResponse,
  metaLeadRateLimitIp,
  verifyMetaSignature,
} from "@/lib/meta-leadgen";
import { placeAvaDemoCallback } from "@/lib/place-demo-callback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Meta Lead Ads Instant Form → existing Ava demo callback.
// GET: hub.challenge verification. POST: fetch the lead, UK mobile only, ring Ava.
// Same telephony as homepage /try / /api/demo-callback (profile_slug wisecall).

export async function GET(request: Request) {
  const expected = getMetaVerifyToken();
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "META_VERIFY_TOKEN is not configured." },
      { status: 503 },
    );
  }

  const challenge = metaHubChallengeResponse(new URL(request.url).searchParams, expected);
  if (!challenge) {
    return NextResponse.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  return new Response(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (getMetaAppSecret() && !verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ ok: false, error: "Invalid signature." }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const changes = extractLeadgenChanges(payload);
  if (changes.length === 0) {
    return NextResponse.json({ ok: true, skipped: "no leadgen changes" });
  }

  if (!getMetaPageAccessToken()) {
    console.error("meta-leadgen: META_PAGE_ACCESS_TOKEN is not configured");
    return NextResponse.json(
      { ok: false, error: "META_PAGE_ACCESS_TOKEN is not configured." },
      { status: 503 },
    );
  }

  const results: Array<Record<string, unknown>> = [];
  let retryableFailure = false;

  for (const change of changes) {
    const fetched = await fetchGraphLead(change.leadgenId);
    if (!fetched.ok) {
      console.error("meta-leadgen: Graph lead fetch failed", {
        leadgen_id: change.leadgenId,
        page_id: change.pageId,
        status: fetched.status,
        error: fetched.error,
      });
      results.push({
        leadgen_id: change.leadgenId,
        ok: false,
        error: fetched.error,
      });
      if (fetched.retryable) retryableFailure = true;
      continue;
    }

    const phone = extractUkMobileFromFieldData(fetched.lead.field_data);
    if (!phone) {
      console.log("meta-leadgen: skipped non-UK or missing mobile", {
        leadgen_id: change.leadgenId,
        page_id: change.pageId,
        form_id: change.formId,
      });
      results.push({
        leadgen_id: change.leadgenId,
        ok: true,
        skipped: "not a UK mobile",
      });
      continue;
    }

    const placed = await placeAvaDemoCallback({
      phone,
      source: META_LEADGEN_SOURCE,
      headers: request.headers,
      rateLimitIp: metaLeadRateLimitIp(change.pageId),
    });

    if (!placed.ok) {
      console.error("meta-leadgen: demo callback failed", {
        leadgen_id: change.leadgenId,
        page_id: change.pageId,
        status: placed.status,
        error: placed.error,
      });
      results.push({
        leadgen_id: change.leadgenId,
        ok: false,
        error: placed.error,
      });
      if (placed.status >= 500 || placed.status === 429) retryableFailure = true;
      continue;
    }

    console.log("meta-leadgen: Ava callback placed", {
      leadgen_id: change.leadgenId,
      page_id: change.pageId,
      form_id: change.formId,
      source: META_LEADGEN_SOURCE,
    });
    results.push({
      leadgen_id: change.leadgenId,
      ok: true,
      message: placed.message,
    });
  }

  const status = retryableFailure ? 500 : 200;
  return NextResponse.json({ ok: !retryableFailure, results }, { status });
}
