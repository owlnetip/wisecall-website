# wisecall-edge

Voice call runtime for WiseCall agents. Deploy to `/opt/wisecall-edge` on the telephony server.

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
- `WISECALL_EMAIL_WEBHOOK_SECRET` — optional, must match the Supabase `wisecall-email-summary` function secret when that function is protected.
- `WISECALL_EMAIL_SUMMARY_URL` — optional override; defaults to `${SUPABASE_URL}/functions/v1/wisecall-email-summary`.

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
