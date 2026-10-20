# WiseCall Data Shield — Vendor Evaluation Checklist

Date: 18 July 2026  
Purpose: RFP-style checklist for selecting a third-party PII shield partner to sell as **WiseCall Data Shield** (Pro/Enterprise bolt-on).  
Architecture baseline: Supabase (London), `wisecall-edge` voice runtime, Supabase Edge Functions for async channels, Anthropic + OpenAI upstream.

---

## 1. Executive summary for vendors

WiseCall is a UK AI receptionist platform. Caller and visitor PII flows to third-party LLMs at multiple points today with no automated minimization. We want a partner whose API (or self-hosted component) sits **inside our perimeter** and provides:

1. **Detect** sensitive entities in text (and optionally audio transcripts)
2. **Tokenize** with semantic placeholders (`Person_1`, `NHSNumber_1`, etc.)
3. **Forward** only tokenized payloads to LLM providers
4. **Restore** real values on responses before customer-facing output, webhooks, and CRM integrations
5. **Audit** every shield/restore event per tenant without persisting raw PII in vendor logs

Initial rollout: **after-call analysis** (batch). Phase 2: email/SMS/WhatsApp/chat. Phase 3: live voice (streaming, strict latency).

---

## 2. Must-have requirements (deal breakers)

Score each vendor **Pass / Partial / Fail**. Any Fail in this section disqualifies unless a documented workaround exists with WiseCall engineering sign-off.

### 2.1 Data residency and processing

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| R1 | **Unredacted PII never leaves UK/EU** for detection/tokenization, OR vendor offers **self-hosted / VPC deploy** in our Supabase/Vercel region (`lhr1` / EU) | UK GDPR, dental/legal/care buyers |
| R2 | Clear sub-processor list; DPA and SCCs available | Enterprise procurement |
| R3 | Configurable **data retention**: zero retention of request/response bodies by default | Transcripts contain PHI/ privileged content |
| R4 | No use of customer content for model training | Standard enterprise ask |

### 2.2 Reversible tokenization (not one-way redaction)

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| T1 | **Semantic tokens** preserved for LLM reasoning (entity type + stable ID within session) | Agent must distinguish Person_1 vs Person_2 |
| T2 | **Restore API** or inline restore on same session — map lives in volatile memory only | Summaries, webhooks, spoken replies need real names/phones |
| T3 | Token map **not persisted** to disk/object storage by default | Matches "architecture not policy" story |
| T4 | Support **selective shielding rules** (e.g. shield NHS/postcode/account ref; optionally keep first name) | Contact memory needs some identity for UX |

### 2.3 Integration fit (Supabase + edge)

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| I1 | **HTTPS REST or gRPC API** callable from Node.js (`wisecall-edge`) and Deno (Supabase Edge Functions) | No Python-only SDK without a sidecar |
| I2 | **Per-request tenant ID** + API key scoping for multi-tenant SaaS | One WiseCall install, many customers |
| I3 | **Idempotent session ID** across multi-turn conversations (chat, voice session, email thread) | Same caller = same token IDs within session |
| I4 | Stateless or **short-TTL session store** (Redis-compatible) if map cannot live in WiseCall memory | Edge functions are ephemeral |
| I5 | Documented **max payload size** ≥ 32 KB (after-call analysis sends up to ~24 KB transcripts) | `call-analysis.ts` limit |
| I6 | **Webhook-safe restore**: restored text must not leak tokens to customer-configured outbound URLs | Integration webhooks post `{{transcript}}` |

### 2.4 UK / regulated entity coverage

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| E1 | Detect **UK phone numbers**, **postcodes**, **NHS numbers**, **email**, **names**, **addresses** | Core UK SMB + healthcare |
| E2 | Custom regex / dictionary recognizers per tenant (solicitor client refs, account numbers) | Legal/finance verticals |
| E3 | False positive rate metrics on **telephony transcripts** (ASR noise, partial words) | Voice is messy text |
| E4 | Optional **profession / privilege** keyword policies (legal, medical) | Sector sales |

### 2.5 Security and compliance artifacts

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| S1 | SOC 2 Type II (or ISO 27001) report available under NDA | Enterprise security review |
| S2 | Pen test summary within last 12 months | Procurement |
| S3 | **Audit log API**: timestamp, tenant, session, entity types/counts shielded — **no raw values** | Customer-facing compliance dashboard |
| S4 | mTLS or IP allowlisting for production | Lock down edge → vendor path |
| S5 | Rate limits and burst handling documented | Dashboard backfill can trigger batch analysis |

### 2.6 Commercial (bolt-on resale)

| ID | Requirement | Why (WiseCall) |
|----|-------------|----------------|
| C1 | **Metered pricing** (per 1K chars, per session, or per call) suitable for resale with margin | Bolt-on SKU |
| C2 | **OEM / white-label** or silent partner option | Sold as WiseCall Data Shield |
| C3 | SLA ≥ 99.9% with status page | Production voice dependency (phase 3) |
| C4 | Pilot / POC tier or free evaluation credits | 2-week spike on after-call analysis |

---

## 3. Should-have requirements (scored, not blocking)

Weight each **1–5** (5 = best fit).

| ID | Requirement | Notes |
|----|-------------|-------|
| H1 | **Streaming / chunk API** for partial transcripts | Live voice phase 3 |
| H2 | P95 latency **< 50 ms** for ≤ 2 KB text (sync path) | Voice budget |
| H3 | **Audio-native** detect (before STT) or partnership with STT redaction | Strongest voice story |
| H4 | Admin UI for tenant rule templates (Dental / Legal / Care) | Faster onboarding |
| H5 | **Strict mode**: vendor documents air-gapped / no outbound from customer VPC | Top-tier enterprise |
| H6 | SDK or OpenAPI spec with generated TypeScript types | Faster integration |
| H7 | EU-hosted managed option **without** US parent processing | UK public sector |
| H8 | Secret/credential scanning (API keys in pasted content) | Portal support chat, email |
| H9 | Multi-language (Welsh place names, etc.) | Devolved nations |
| H10 | Existing **Anthropic / OpenAI proxy** mode (vendor sits inline) | Minimal WiseCall code change |

---

## 4. WiseCall integration map (where shield must plug in)

Use this table in vendor demos — they should show a sequence diagram for each row.

| Priority | Component | Runtime | LLM | Payload | Latency budget |
|----------|-----------|---------|-----|---------|----------------|
| **P0 (pilot)** | After-call analysis | Next.js server (`apps/portal/src/lib/call-analysis.ts`) | Claude Opus | Full transcript + summary | Seconds OK |
| **P1** | Email inbound | Supabase `wisecall-email-inbound` | Claude Opus | Inbound body + memory block | < 2 s |
| **P1** | SMS inbound | Supabase `wisecall-sms-inbound` | Claude Opus | Message + memory | < 2 s |
| **P1** | WhatsApp inbound | Supabase `wisecall-whatsapp-inbound` | Claude / GPT fallback | Message + memory | < 2 s |
| **P1** | Live chat | Supabase `wisecall-live-chat` | GPT-4.1 mini | Chat history + KB | < 1 s |
| **P2** | Agent learning | Portal cron (`agent-memory.ts`) | Claude Sonnet | Unanswered questions | Batch |
| **P2** | Portal support (Ava) | Portal action | Claude Sonnet | User message | < 2 s |
| **P3** | Live voice | External handler + `wisecall-edge` | OpenAI Realtime (typical) | Streaming transcript / tool args | **< 100 ms**/chunk |
| **P3** | Integration webhooks | `wisecall-edge` tools | N/A | Tool payloads with caller fields | Restore before POST |

**Restore points (non-negotiable):** customer email/SMS replies, call summaries, `wisecall_call_logs` fields shown in portal, integration webhook bodies, action-item emails.

---

## 5. Reference architecture (target state)

```text
┌─────────────────────────────────────────────────────────────────┐
│ WiseCall tenant (profile_id) — Data Shield enabled              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Inbound text/audio ──► [Shield API: detect + tokenize]         │
│                              │                                  │
│                              ▼                                  │
│                    Tokenized prompt ──► Anthropic / OpenAI      │
│                              │                                  │
│                              ▼                                  │
│  Outbound to caller/CRM ◄── [Restore API] ◄── Model response    │
│                                                                 │
│  Audit: { tenant, session, entities[], counts } — no raw PII    │
└─────────────────────────────────────────────────────────────────┘
```

**Session key:** `{profile_id}:{channel}:{session_id}`  
Examples: `uuid:phone:callId`, `uuid:email:threadId`, `uuid:analysis:callLogId`

**Tenant config (stored in `wisecall_profiles.metadata.data_shield`):**

```json
{
  "enabled": true,
  "mode": "standard",
  "rules": {
    "shield_nhs": true,
    "shield_postcode": true,
    "shield_phone": true,
    "preserve_first_name": true
  }
}
```

---

## 6. Proof-of-concept acceptance criteria (2-week spike)

Vendor must pass all POC items on **after-call analysis only** before voice evaluation.

| # | Test | Pass criteria |
|---|------|---------------|
| 1 | Sample dental transcript (synthetic) | NHS number, name, phone tokenized; Claude summary still coherent |
| 2 | Restore | Portal summary and `caller_name` / `callback_phone` in analysis JSON show real values |
| 3 | Webhook | Simulated `after_call` webhook receives **restored** transcript, not tokens |
| 4 | Session isolation | Two concurrent analyses for different tenants — no token collision |
| 5 | Audit | API returns entity counts; vendor confirms no raw body in their logs |
| 6 | Failure mode | Shield API down → WiseCall queues analysis or fails closed (configurable); never sends raw transcript silently |
| 7 | Latency | P95 shield+restore < 500 ms for 8 KB transcript |
| 8 | Cost | Priced estimate for 10K calls/month at avg 3 KB transcript |

**POC test fixture (redacted example):**

```text
Caller: Hi, I'm John Miller, NHS number 943 476 5919. I need to move my appointment
at 14 Oak Lane, SW1A 1AA. You can reach me on 07700 900123.
```

Expected tokens (illustrative): `Person_1`, `NHSNumber_1`, `Address_1`, `Postcode_1`, `Phone_1`.

---

## 7. Vendor questionnaire (send as RFP appendix)

1. Where does **plaintext** processing occur (region, legal entity)? Provide a data flow diagram.
2. Is tokenization **reversible within session**? Where is the mapping stored (memory, Redis, DB)? Default TTL?
3. List all **sub-processors** and regions for detection, storage, and logging.
4. Provide **UK-specific entity** list and F1/recall on telephony transcript benchmark (or run our POC fixture).
5. What is P50/P95 latency for 500 B, 2 KB, 8 KB, 32 KB payloads?
6. Do you offer **inline LLM proxy** (single endpoint) vs separate shield/restore calls?
7. Can we **self-host** or deploy into our AWS/Azure VPC in `eu-west-2`?
8. What appears in **audit logs**? Can you guarantee no raw PII in vendor SIEM?
9. Pricing model for **resale** (volume tiers, minimum commit, OEM discount)?
10. Incident response: notification SLA, breach history (last 3 years)?
11. Support for **fail-closed** vs **fail-open** per tenant?
12. Roadmap for **streaming** tokenization (SSE/WebSocket)?

---

## 8. Scoring matrix (internal)

| Category | Weight | Vendor A | Vendor B | Vendor C |
|----------|--------|----------|----------|----------|
| Must-haves (§2) | 40% | | | |
| UK entity accuracy (POC) | 15% | | | |
| Latency / streaming (§3 H1–H2) | 10% | | | |
| Integration effort (§2 I*, §3 H6/H10) | 15% | | | |
| Commercial / OEM (§2 C*, §3) | 10% | | | |
| Compliance artifacts (§2 S*) | 10% | | | |
| **Total** | 100% | | | |

**Decision rule:** No vendor proceeds to phase 3 (voice) without POC pass + legal review of DPA + engineering estimate ≤ 3 weeks for P0+P1 integration.

---

## 9. Candidate vendor types (initial longlist)

Use this list to seed outreach — **not an endorsement**. Re-score with §2–§8.

| Vendor type | Examples to evaluate | Pros | Cons |
|-------------|---------------------|------|------|
| LLM privacy proxy | Grepture, similar EU proxies | Fast mask+restore, minimal code | Verify UK entities + residency |
| Data privacy vault / GenAI | Skyflow | Strong enterprise, audio support | Cost, integration complexity |
| DLP / API security | Nightfall, Strac | Known in enterprise | Often inspect-before-redact — verify R1 |
| Detection API | Private AI, cloud Comprehend | High accuracy NER | WiseCall builds restore layer |
| Self-hosted OSS | Microsoft Presidio | No per-token fee | WiseCall owns ops, audit, restore |

---

## 10. WiseCall product packaging (for GTM alignment)

| SKU | Audience | Includes |
|-----|----------|----------|
| **Data Shield Standard** | Pro add-on | Async channels + after-call analysis; UK entity set; audit in portal |
| **Data Shield Enterprise** | Enterprise / regulated | Standard + custom rules + dedicated support + optional VPC |
| **Data Shield Strict** | Legal / NHS (future) | Customer inference endpoint or air-gapped deploy; sales-led |

Suggested pilot pricing hypothesis: **£79–149/mo per active agent** or **£0.02–0.05 per shielded minute** — validate against vendor COGS before launch.

---

## 11. Internal owners and next steps

| Step | Owner | Output |
|------|-------|--------|
| Shortlist 3 vendors | Product + Founder | Outreach + NDAs |
| Run POC (§6) | Engineering | Pass/fail report |
| Legal review DPA | Ops | Sub-processor addendum to WiseCall DPA |
| Portal toggle + billing | Engineering | `metadata.data_shield` + Stripe add-on |
| Sales one-pager | GTM | "The model never sees a real value" + architecture diagram |

---

## 12. Related internal docs

- `docs/portal-product-audit-2026-07.md` — tenant isolation (C1) should progress in parallel with Data Shield
- `apps/portal/src/lib/call-analysis.ts` — P0 integration target
- `wisecall-edge/README.md` — voice session lifecycle for P3
- `supabase/functions/_shared/contact-memory.ts` — memory block injected into LLM prompts (shield input here in P1)
