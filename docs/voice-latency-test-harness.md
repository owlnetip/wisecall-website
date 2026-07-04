# Voice-agent latency test harness

End-to-end latency testing for the live WiseCall phone path (SIP / MOR → AWS middleware → Deepgram → OpenAI → Cartesia).

## Components

| Piece | Location |
|-------|----------|
| Supabase schema | `supabase/migrations/20260704150000_wisecall_voice_latency_tests.sql` |
| Middleware instrumentation | `wisecall-edge/src/latencyInstrumentation.js` |
| Turn webhook (SIP bridge → portal) | `POST /api/webhooks/latency-turn` |
| Twilio test caller CLI | `apps/portal/scripts/test-voice-agent.mjs` |
| Admin dashboard | `/admin/latency` |

## Run a test

```bash
cd apps/portal

# Required env
export SUPABASE_URL=...
export SUPABASE_SERVICE_ROLE_KEY=...
export TWILIO_ACCOUNT_SID=...
export TWILIO_AUTH_TOKEN=...
export TWILIO_LATENCY_TEST_FROM=+44...   # verified Twilio outbound number

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
| &lt; 900 ms | **PASS** |
| 900–1500 ms | **WARN** |
| &gt; 1500 ms | **FAIL** |

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
- `voice_latency_tests` — individual outbound test calls + recordings
- `voice_latency_test_turns` — per-turn client + server metrics

## Apply migration

```bash
supabase db push
# or apply apps/portal/supabase/migrations/0019_voice_latency_tests.sql in Studio
```
