# wisecall-edge

Voice call runtime for WiseCall agents. Deploy to `/opt/wisecall-edge` on the telephony server.

This package owns session lifecycle (billing gate, prompts, webhooks, call logs). It does **not** open the Telnyx media socket or call Cartesia/Deepgram. Those live in the telephony TTS/STT process on the same host.

## Website demo voice (Sonic 3.6 + Ink-2)

The wisecall.io phone demo is profile slug `wisecall` (DDI `+441135222277`). Metadata on that row now includes `tts_model=sonic-preview`, `tts_locale=en-GB`, `stt_provider=cartesia`, `stt_model=ink-2`.

The Telnyx caller must import `resolveVoicePipeline(profile)` from this package (or copy the same rules) and:

1. Send Cartesia TTS `model_id` from `pipeline.ttsModel` (website demo: `sonic-preview` — Cartesia’s current Sonic 3.6 id; override with `CARTESIA_MODEL=sonic-3.6` or `sonic-latest` if GA aliases those).
2. Pass `locale: "en-GB"` on Sonic 3.6 (do **not** also send `language`; do **not** send `locale` on Sonic 3.5 — it 400s).
3. Set `Cartesia-Version: 2026-08-14` on TTS/STT requests.
4. For the demo agent only, switch STT from Deepgram to Cartesia Ink-2 (`wss://api.cartesia.ai/stt/websocket?model=ink-2`, English only). Leave other agents on Deepgram until Ink-2 is proven.
5. Do not use a Professional Voice Clone on `sonic-preview` / beta; stock and instant-clone IDs are fine.

A global `CARTESIA_MODEL=sonic-preview` on the telephony host would flip **every** Cartesia agent. Prefer per-profile `metadata.tts_model` or `resolveVoicePipeline`.

## Call lifecycle

```text
incoming call
  → prepareCallSession()     billing gate + contact memory + before_call webhooks
  → LLM conversation         during_call webhooks registered as tools
  → finalizeCallSession()    saveCallLog + contact upsert + after_call webhooks
```

Custom integration webhooks are configured per agent in the portal **Technical** tab and stored on `wisecall_profiles.metadata.integration_webhooks`.

## Environment

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `WISECALL_EMAIL_WEBHOOK_SECRET`: optional, must match the Supabase `wisecall-email-summary` function secret when that function is protected.
- `WISECALL_EMAIL_SUMMARY_URL`: optional override; defaults to `${SUPABASE_URL}/functions/v1/wisecall-email-summary`.

## Wiring into an existing handler

If you already have a Telnyx / MOR call handler, import the session API:

```javascript
const {
  prepareCallSession,
  handleIntegrationToolCall,
  finalizeCallSession,
  mergeIntegrationTools,
} = require("./lib/callSession");

// 1. After loading the profile row:
const session = await prepareCallSession(profile, { callId, callerId });
if (!session.allowed) {
  // refuse or play trial-cap message
  return;
}

// 2. Pass session.systemPrompt to the LLM; merge webhook tools with built-ins:
const tools = mergeIntegrationTools(session, builtInTools);

// 3. On LLM tool invocation:
const integrationResult = await handleIntegrationToolCall(session, toolName, args);
if (integrationResult) return integrationResult;

// 4. On hangup:
await finalizeCallSession(session, {
  transcript,
  summary,
  outcome,
  callerName,
  startedAt,
  finishedAt,
});
```

## Portal reference copies

`apps/portal/src/lib/*.runtime.js` are synced from `src/lib/` for documentation. After editing libs here, run:

```bash
npm run sync:portal
```

## Tests

```bash
npm test
```
