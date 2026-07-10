# Voice-agent latency test harness

End-to-end latency testing for the live WiseCall phone path (MOR SIP → AWS middleware → Deepgram → OpenAI → Cartesia).

## Components

| Piece | Location |
|-------|----------|
| Supabase schema | `supabase/migrations/20260704150000_wisecall_voice_latency_tests.sql` |
| Middleware instrumentation | `wisecall-edge/src/latencyInstrumentation.js` |
| Turn webhook (SIP bridge → portal) | `POST /api/webhooks/latency-turn` |
| MOR/SIP test caller CLI | `apps/portal/scripts/test-voice-agent.mjs` |
| SIPp scenario builder | `apps/portal/scripts/build-sipp-scenario.mjs` |
| Prompt audio generator | `apps/portal/scripts/generate-latency-prompts.mjs` |
| Admin dashboard | `/admin/latency` |

## Prerequisites

1. **Dedicated MOR SIP device** for the test caller (register on your MOR server)
2. **SIPp** installed on the machine running tests (`apt install sip-tester` / `brew install sipp`)
3. **espeak-ng** (optional) for generating prompt WAVs (`apt install espeak-ng`)
4. Supabase migration applied

## Setup

### 1. Create a latency-test SIP device on MOR

Provision a SIP device under your MOR reseller (same stack as WiseCall agents). Note:
- SIP username → `MOR_LATENCY_TEST_SIP_USER`
- SIP password → `MOR_LATENCY_TEST_SIP_PASSWORD`
- MOR SIP host → `MOR_SIP_DOMAIN` (or derived from `MOR_API_URL`)

### 2. Generate prompt audio

```bash
cd apps/portal
node scripts/generate-latency-prompts.mjs --scenario=dental
```

### 3. Run tests

```bash
cd apps/portal

export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export MOR_SIP_DOMAIN=sip.your-mor-host.example
export MOR_LATENCY_TEST_SIP_USER=latency_test
export MOR_LATENCY_TEST_SIP_PASSWORD=...

npm run test:voice-agent -- --number="+441135222277" --scenario=dental --calls=5
```

From repo root:

```bash
npm run test:voice-agent -- --number="+441135222277" --scenario=dental
```

### Scenarios

- `dental` — four-turn dental reception script (default)
- `generic` — three-turn generic business script

### Verdicts

| p95 latency | Verdict |
|-------------|---------|
| < 900 ms | **PASS** |
| 900–1500 ms | **WARN** |
| > 1500 ms | **FAIL** |

## How it works

1. CLI creates a `voice_latency_test_runs` row in Supabase
2. For each call, **SIPp** registers to MOR and places an outbound INVITE to the target WiseCall DID
3. SIPp plays pre-generated WAV prompts (`rtp_stream`) with pauses for agent responses
4. Server-side middleware posts per-turn timestamps to `/api/webhooks/latency-turn`
5. CLI polls Supabase, correlates via MOR CDR (`calls_get`) and `wisecall_call_logs`
6. Summary printed with p50/p95/p99 and PASS/WARN/FAIL

## SIP bridge instrumentation

The live telephony handler should POST per-turn timestamps after each conversational turn:

```http
POST https://app.wisecall.io/api/webhooks/latency-turn
x-wisecall-secret: <WISECALL_WEBHOOK_SECRET>
Content-Type: application/json

{
  "call_id": "call-abc123",
  "turn_id": 1,
  "test_run_id": "optional-uuid",
  "audio_received_at": "2026-07-04T12:00:00.000Z",
  "deepgram_first_partial_at": "2026-07-04T12:00:00.120Z",
  "deepgram_final_at": "2026-07-04T12:00:00.350Z",
  "openai_request_started_at": "2026-07-04T12:00:00.360Z",
  "openai_first_token_at": "2026-07-04T12:00:00.620Z",
  "cartesia_request_started_at": "2026-07-04T12:00:00.630Z",
  "cartesia_first_audio_at": "2026-07-04T12:00:00.780Z",
  "audio_sent_to_sip_at": "2026-07-04T12:00:00.900Z"
}
```

Or call directly from the telephony server via wisecall-edge:

```js
const { recordTurnLatency } = require("wisecall-edge");
await recordTurnLatency({ call_id, turn_id, ...timestamps });
```

Pass `latencyTestRunId` into `prepareCallSession()` when running a scheduled harness so turns auto-link to the active test run.

## Tables

- `voice_latency_test_runs` — batch run summary (p50/p95/p99, verdict)
- `voice_latency_tests` — individual test calls + MOR/SIP refs + recording URLs
- `voice_latency_test_turns` — per-turn client + server metrics

## Apply migration

```bash
supabase db push
# or apply apps/portal/supabase/migrations/0019_voice_latency_tests.sql in Studio
```

## Optional MOR CDR correlation

Set these for automatic call matching via MOR `calls_get`:

```
MOR_API_URL
MOR_API_SECRET
MOR_UNIQUE_HASH
MOR_WISECALL_RESELLER_USERNAME
```
