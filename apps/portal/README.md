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
- `/dashboard` - customer-only portal shell
- `/admin` - Owlnet/WiseCall admin shell

## Environment

Copy `.env.example` to `.env.local` for local development.

Required for Supabase-backed writes:

- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

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
