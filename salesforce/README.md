# BetterMove sandbox SMS action — deployment pending

Separate WiseCall action for Contact, unconverted Lead and Person Account. This
package contains no ActiveCampaign changes and no existing layout changes.
It is local source, not an installed or validated Salesforce action yet.

The server reads record phones using Salesforce user-mode permissions. Lookup
reveals the candidate count and whether the opened record matches, not other
records' private details. The user explicitly confirms this record and assignment
of replies to their signed-in Salesforce user. Sign in as Luke for Luke's test,
not Lewis or the integration user.

Authentication uses a Named Credential named `WiseCall_SMS`. Configure its HTTPS
origin to the approved SMS portal preview with secure custom headers
`x-wisecall-salesforce-secret` and `x-vercel-protection-bypass`, supplied from an
External Credential. Never put either secret in Apex, labels, browser code, URLs,
or version control. The included labels are public agent/sender configuration only.

## Sandbox installation

Requires an authorised Salesforce admin CLI connection; it is not yet configured.
Verify the target host is `bettermove--dev.sandbox.my.salesforce.com`, never production.

1. From this directory validate without deploying:
   `sf project deploy start --dry-run --source-dir force-app --target-org bettermove-dev --test-level RunSpecifiedTests --tests WiseCallSmsControllerTest`
2. Only after validation succeeds deploy the same source, omitting `--dry-run`.
3. Configure the Named/External Credential and grant its principal access only
   to approved SMS users. Assign the separate `WiseCall_SMS_Send` permission set.
4. Add **Send WiseCall SMS** to the relevant Account/Contact/Lead record actions,
   preserving all existing actions and especially ActiveCampaign.
5. Deploy the updated portal inbound callback and the patched **current live**
   Supabase inbound function before any send. The downloaded release directory is
   `/private/tmp/wisecall-inbound-release.jfbTZb`; it preserves the existing GET
   webhook health check, numeric sender, receptionist and background processing.
6. Run a user-initiated handset test from Luke's existing record. The linked
   Contact is `003Q100000f6c0CIAQ`; Luke's user is `005Q100000GGM0CIAX`.
   Check the reply Task belongs to Luke and no AI response is sent on that thread.

Opening the action and checking the lookup do not send SMS. An explicit Send click
is required. No footer is appended. An uncertain send locks the form: reconcile
delivery before starting another request. Failed inbound deliveries remain logged
for review; automatic retries are deliberately not implemented because Salesforce
Task creation is not idempotent after an uncertain network result.

## Verification status

- Person Account lookup verified against the real sandbox in the previous preview.
- 42 Node tests pass for matching, numeric transport and fail-closed inbound routing.
- Portal TypeScript check passes.
- Apex tests are supplied but not executed; Salesforce compilation/LWC UI validation,
  credential setup, permissions, action placement and handset test remain outstanding.
- Deployment tooling was blocked by the Codex approval service usage limit; do not
  work around that approval failure through another execution path.
