# Existing SMS function: numeric agent sender

The deployed `wisecall-send-sms` now accepts a service-authenticated numeric-agent path, using the same shared Vonage Messages API transport as the SMS receptionist. It was based on the live downloaded function, not the older OwlNet checkout. Existing shared-secret callers without `from` retain their original implementation. No inbound function or Salesforce endpoint was deployed with this change.

Service POST body: `request_id` (UUID), `profile_id` (UUID), `from`, `phone`, `message` (1–1000 nonblank characters). An explicit active `wisecall_sms_numbers` row for that profile must match `from`. There is no global sender fallback for service calls. The legacy webhook secret alone cannot select an agent sender.

Authentication accepts the runtime service key, or a legacy service-role JWT independently validated for administrative access by Supabase Auth. Merely decoding the JWT is not sufficient. The admin permission probe discards its response body without inspecting or logging user data. Anonymous and ordinary user tokens are rejected.

The UUID is reserved in the existing `wisecall_call_logs.id` primary key before contacting Vonage. Repeating a successful identical request replays the saved result. Pending/uncertain attempts block further sends. Reusing the ID with a changed payload is rejected. Existing SMS usage tracking is called after provider acceptance. An ambiguous result must be reconciled before any new request ID is used.

## Approved BetterMove test, 24 September 2026

- Profile: `b3b2374c-ddc6-4e66-87a8-c60703ac89f9` (Bettermove Receptionist).
- Sender: `447451273985`.
- Request ID: `74f4870b-8f33-4d9a-9bc9-95691902d2c6`.
- Vonage message ID: `8b9d455b-3f15-43f8-a755-ac5c40086f4c`.
- Provider accepted one test; prior attempts returned 401 before any send reservation.
- This confirms provider acceptance, not a handset delivery receipt or Salesforce routing.

The 37 targeted SMS tests passed. Portal-wide TypeScript checking in this turn was blocked by duplicate generated `.next/types/* 2.ts` definitions; those unrelated generated files were left untouched. The Supabase deployment bundled this function and its two shared modules successfully.

No Vonage secrets were exported or changed. The old disabled `wisecall-company-sms-test` function was not reactivated. This service-only operator send path is not the public Salesforce API: it does not look up Salesforce, create reply bindings or claim that replies will become Salesforce Tasks. Until that separate integration is deployed and a binding confirmed, replies continue on the existing inbound receptionist path.
