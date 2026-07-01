# WiseCall Portal

Separate Next.js app for `app.wisecall.io`.

## Purpose

- Keep `wisecall.io` as the public marketing website.
- Run demo-agent intake, customer portal and Owlnet admin from a separate Vercel project.
- Use the existing WiseCall Supabase project as the shared source of truth.
- Deploy Vercel Functions in London with `regions: ["lhr1"]`.

## Routes

- `/` - portal landing and quick demo request form
- `/demo/new` - website + mobile intake for a demo agent
- `/demo/[id]` - public/private demo agent page
- `/dashboard` - customer-only portal shell (includes the **AI Insights** view)
- `/admin` - Owlnet/WiseCall admin shell
- `/api/insights` - authenticated, tenant-scoped AI Insights roll-up (`?range=today|7d|30d`)
- `/api/insights/backfill` - authenticated, analyses a small batch of the tenant's un-analysed calls
- `/api/webhooks/call-completed` - service webhook the call runtime POSTs after a call completes; runs the after-call AI analysis (secret-protected)

## AI Insights

After a call completes, an AI analysis step (`src/lib/call-analysis.ts`) reads the
call's transcript + summary, asks Claude for a single strict-JSON verdict
(sentiment, intent, outcome, urgency, complaint/lead/booking flags, unanswered
questions, opportunities, a one-line manager summary) and stores it on the
`wisecall_call_logs` row (columns added in migration `0008_call_ai_insights.sql`).

The dashboard **AI Insights** view aggregates these stored fields per tenant and
date range - it never calls the model, so it stays fast and cheap. Trigger the
analysis one of these ways:

- **After-call webhook** (preferred): point the call runtime at
  `POST /api/webhooks/call-completed` with header `x-wisecall-secret: <WISECALL_WEBHOOK_SECRET>`
  and body `{ "call_id": "<wisecall_call_logs.id>" }`.
- **On-demand backfill**: the dashboard automatically backfills any un-analysed
  history the first time a customer opens AI Insights.
- **Bulk backfill script**: `node scripts/backfill-call-analysis.mjs [--limit=200] [--owner=<auth-user-id>]`.

## Environment

Copy `.env.example` to `.env.local` for local development.

Required for Supabase-backed writes:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Required for AI Insights (after-call analysis):

- `ANTHROPIC_API_KEY` (or `CLAUDE_API_WISECASE`) - Claude API key used server-side for call analysis. Without it, the dashboard still renders but no new analysis is produced.
- `WISECALL_WEBHOOK_SECRET` - shared secret for the `POST /api/webhooks/call-completed` after-call trigger. The runtime must send it as `x-wisecall-secret` (or `Authorization: Bearer <secret>`).

Optional integrations:

- `WISECALL_DEMO_SMS_WEBHOOK_URL` - receives `{ mobile, demoUrl, businessName, industry, demoId, message }`
- `WISECALL_DEMO_CALLBACK_ENDPOINT` - defaults to the existing WiseCall demo callback Edge Function

## Vercel

Create this as its own Vercel project with project root:

```text
apps/portal
```

Assign domain:

```text
app.wisecall.io
```

The local `vercel.json` sets Vercel Function execution to London:

```json
{ "regions": ["lhr1"] }
```
