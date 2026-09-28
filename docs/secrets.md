# Storing secrets and keys

The Supabase project allows 100 edge-function secrets. We were at 107 on 28 Sep 2026.

## Where things go

| Kind | Where | Why |
|---|---|---|
| Platform essentials (Supabase, main Stripe, Vonage, Claude, Deepgram, Cartesia) | Edge-function secrets | Few, used everywhere |
| Per-client or per-integration keys (a client's CRM, Salesforce apps, reseller logins) | **Supabase Vault** | No limit, encrypted at rest |
| Settings that aren't secret (flags, URLs, IDs, sender numbers) | A settings table or profile metadata | Don't need secret storage |
| Portal (Next.js) server keys | Vercel env, marked **sensitive** | Hidden even from dashboard viewers |

## Vault

- Read in a function: `import { getSecret } from "../_shared/app-secrets.ts"` then `await getSecret("NAME")`.
  Vault first, then the env secret, cached 5 minutes, never logged.
- Store: `select vault.create_secret('<value>', 'NAME', 'what it is for');`
- Rotate: `select vault.update_secret((select id from vault.secrets where name = 'NAME'), '<new value>');`
- `public.get_app_secret(name)` is service_role only (anon/authenticated are revoked).
- Move a key: store it in Vault under the same name, deploy the function using `getSecret`, confirm it works, then delete the env secret.

## Sharing keys between people

Never paste keys into chat, email or tickets. Use a password manager share or a one-time secret link,
then load the value straight into Vault or Vercel (e.g. from the clipboard) without printing it.
Rotate any key that was pasted somewhere.
