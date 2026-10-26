# Salesforce SMS preview access

The portal API requires `x-wisecall-salesforce-secret`. A protected Vercel
preview additionally requires `x-vercel-protection-bypass`. These are separate
credentials; neither replaces the other. Keep both server-side, never in a
Flow screen, browser bundle, URL, logs, or version control.

The Supabase inbound callback accepts a plain `WISECALL_SALESFORCE_SMS_SECRET`
or a JSON object in that existing secret slot:

```json
{"secret":"<SMS shared secret>","vercel_bypass":"<Vercel automation secret>"}
```

The Vercel portal's variable must remain the **plain SMS shared secret**, not
the JSON object. A structured Supabase value avoids requiring another secret
slot. The callback requires an HTTPS origin in `WISECALL_PORTAL_URL`, prohibits
embedded credentials/query strings, uses separate authentication headers, and
refuses redirects. HTTP success without explicit confirmed Task delivery is
recorded as undelivered and must never fall back to the AI receptionist.

Vercel automation bypass keys apply across this project's protected deployments,
not just this endpoint. Their creation/storage requires explicit approval.
Revoke the testing key when the protected-preview integration is retired.

Deployment note: the live inbound function has newer GET webhook validation,
numeric sender helpers, and background processing than the original PR version.
Port the routing hook into the current live source; do not overwrite it with an
older inbound implementation. No live inbound deployment is implied by this file.
