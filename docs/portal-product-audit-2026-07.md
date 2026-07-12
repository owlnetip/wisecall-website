# WiseCall Portal Product Audit

Date: 10 July 2026  
Baseline: `origin/main` at `19b1558`  
Scope: `apps/portal`, shared voice runtime in `wisecall-edge`, relevant Supabase migrations, and the authenticated product information architecture.

## Executive summary

WiseCall already has a clear visual identity, a strong outcome-led home dashboard, useful empty states, and sensible mobile list/detail patterns for Inbox and Contacts. The highest-value work is not a visual redesign. It is making the product state more truthful and operationally safe, then separating the current all-in-one workspace into testable route-level product areas.

The most important risks are:

1. Tenant hardening is incomplete. The checked-in migration explicitly leaves RLS disabled on `wisecall_profiles`, while that table can contain integration credentials.
2. Admin checks trust user-editable account metadata as well as server-controlled metadata.
3. Website onboarding performs a server-side fetch without blocking private or local network destinations.
4. First-agent creation can allocate a number and activate the agent in the same transaction, without a persisted draft/publish boundary.
5. Provider-managed phone and live-status fields pass through the general customer update action.
6. Outbound blasts can queue a large volume of real calls without a review/confirmation stage, an idempotency key, or a server-side recipient limit.
7. Dashboard data errors are commonly converted into empty arrays, so an outage can look like a genuinely empty Inbox or Contacts list.
8. The internal prospect-demo API is publicly callable, and the public callback demo has no durable abuse control.
9. Email confirmation accepts an unvalidated post-authentication redirect target.
10. Most of the customer product is a single 5,675-line client component, with no portal tests and a failing lint baseline.

The recommended approach is a staged refinement, beginning with trust and safety, then agent lifecycle and integrations, then operational workflows, and only then broad component-system polish.

## Evidence and baseline

- The customer workspace is 5,675 lines / about 208 KB of source and owns Home, Inbox, Contacts, Agents, Channels, agent settings, call detail, knowledge, routing, and several modals.
- The portal has 10 page routes and no committed unit, component, or browser tests.
- `npm run build` passes on Next.js 16.2.9 and React 19.2.4.
- TypeScript passes with `tsc --noEmit`.
- ESLint fails with 13 errors and 5 warnings, including React effect issues and synced CommonJS runtime files.
- `npm audit` reports two moderate issues through Next.js' bundled PostCSS dependency. There is no safe automatic fix in the current report.
- The edge runtime has eight tests; all pass.
- There are 164 hand-styled buttons, 88 form controls, more than 80 hard-coded colour values/usages, and no shared Button, Input, Dialog, Alert, Skeleton, or Toast primitives.
- The light tertiary text token (`#97a29f` on white) has a 2.63:1 contrast ratio and is used for more than placeholders.
- There is one `focus-visible` style in TSX while 50 controls explicitly remove their outline.
- Production/authenticated browser inspection is still required. The embedded browser was unavailable during this audit, so responsive and interaction findings below combine source inspection, existing screenshots, and build verification.

## Critical findings

| ID | Current problem | Why it matters | Recommended improvement | Expected user benefit | Development risk | Timing |
| --- | --- | --- | --- | --- | --- | --- |
| C1 | `wisecall_profiles` RLS is not enabled by any checked-in migration; the migration comments state anonymous reads may expose profile secrets. Ownership is enforced in application code using service-role queries. | A missed ownership filter or another client using the anon key can become a cross-tenant data exposure. This is the largest enterprise trust blocker. | Trace every consumer of `wisecall_profiles`, migrate ownership to a canonical column/customer model, remove secret fields from broadly readable rows, enable RLS in staging, and add isolation tests before production rollout. | Defensible tenant isolation and a credible security posture for larger customers. | High: enabling RLS without tracing legacy consumers can stop live call flows or older portals. | Plan immediately; deploy only after dependency audit. |
| C8 | `isAdmin` trusts `user_metadata.role === "admin"` as well as server-controlled app metadata. Supabase user metadata is account-controlled. | A customer may be able to grant themselves admin access, exposing cross-customer agents and destructive admin actions. | Trust only server-controlled `app_metadata`, a server-side admin table, or a protected allowlist. Add a regression test. | Restores a valid authorisation boundary. | Low, but confirm legitimate admins have app metadata or an allowlisted email. | Fix now. |
| C2 | Website onboarding accepts any HTTP(S) hostname and follows redirects during a server-side fetch. Private IPs, localhost, metadata endpoints, and redirect-to-private targets are not blocked. | This is an SSRF path from an authenticated account into WiseCall's server network. Large responses can also consume memory before text is sliced. | Validate scheme, credentials, port, hostname, resolved IPs, every redirect, content type, timeout, and response size. Add unit tests for private/reserved IPv4 and IPv6 ranges. | Safe one-click website onboarding without weakening infrastructure security. | Low to medium: unusually hosted customer sites may need a manual-setup fallback. | Fix now. |
| C3 | Creation and activation are one transaction: `createAgent` may allocate the first pooled number and set `is_active=true`. The final button mentions connecting the number, but there is no way to save a completed draft and publish it separately. | A user cannot complete configuration, test, and obtain approval before production activation. | Short term: make the final consequence unambiguous and show the resulting state. Next: separate Save draft, Test, Publish, Pause, and Unpublish operations with a persisted lifecycle. | Users know exactly when production is affected and can test safely. | Medium to high: a true lifecycle change touches provisioning and live call matching. | Truthful copy now; lifecycle in Phase 2. |
| C4 | Customers can submit `phoneNumber` and `status` through the general `updateAgent` action; the Technical form exposes an editable phone-number field. | A customer can desynchronise pooled-number ownership, collide with another route, or activate/deactivate a live profile outside provisioning controls. | Treat number and live status as provider-managed. Reject these fields for non-admin callers and render the number read-only outside controlled provisioning actions. | Fewer routing outages and clearer ownership of production state. | Low if the UI stops sending the fields first. | Fix now. |
| C5 | "Start blast" can queue a real outbound campaign immediately. There is no review screen, confirmation, idempotency key, recipient cap, duplicate summary, estimated attempts, or explicit consent acknowledgement. | One mistaken CSV or double submission can trigger costly, high-volume customer calls and create compliance risk. | Add Review campaign, recipient/duplicate/invalid counts, maximum-attempt total, schedule/timezone summary, consent acknowledgement, typed confirmation for large sends, idempotency, and server limits. | Safer campaigns with fewer expensive mistakes. | Medium: requires tracing the external worker and deciding commercial limits. | Next critical phase. |
| C6 | Custom webhooks accept arbitrary URLs/headers and execute from the call runtime. There is no private-network egress guard, test connection, delivery log, last success, or visible fallback. | Webhooks create another SSRF/credential surface, and a failed booking or CRM write is invisible to the customer. | Restrict egress, encrypt/mask secrets, add Test connection, persist per-call execution results, define fallback behaviour, and expose clear health states. | Customers can trust whether actions completed and recover failures quickly. | High: runtime compatibility and secret migration require care. | Design now; implement in Phase 2. |
| C7 | Data-layer failures are commonly logged and returned as `[]`/empty insights. The UI then presents genuine empty states such as "Your inbox is ready". | During an outage, users can wrongly conclude that no calls or contacts exist. | Propagate typed load failures, preserve last-known data where possible, and show a non-blocking partial-data warning with retry. Never substitute demo data in an authenticated workspace. | Honest system status and less panic during transient failures. | Low to medium. | Fix now. |
| C9 | `/demo/new` is an internal prospect tool, but `/api/demo-requests` is publicly callable and can create demo records/queue SMS. The intentionally public callback endpoint has no durable rate limit or challenge. | Attackers can consume call/SMS spend, create unwanted communications, and pollute internal data. | Require admin authority for prospect-demo creation. Put the public callback behind a durable per-IP/per-number limiter, bot challenge, velocity alerts, and provider-side spend caps. | Prevents communication abuse and unexpected cost. | Low for the admin endpoint; medium for durable public rate limiting. | Protect admin endpoint now; public limiter before scaling acquisition. |
| C10 | `/auth/confirm` redirects to the raw `next` query value after establishing a session. | A valid confirmation or recovery journey can be turned into an open redirect, enabling convincing phishing immediately after authentication. | Accept only same-origin internal paths through one tested redirect helper. | Safer sign-in, confirmation, and password-recovery journeys. | Low. | Fix now. |

## High-impact findings

| ID | Current problem | Why it matters | Recommended improvement | Expected user benefit | Development risk | Timing |
| --- | --- | --- | --- | --- | --- | --- |
| H1 | Home, Inbox, Contacts, Agents, Channels, agent detail, and many modals live in one 5,675-line client component. | Small changes have a broad regression surface; state is coupled and most code ships to every dashboard visit. | Extract feature modules behind stable typed boundaries, starting with Inbox and Agent Settings. Keep the existing UI while moving ownership. | Faster, safer iteration and clearer feature behaviour. | Medium. | Phase 4, after safety contracts stabilise. |
| H2 | The portal has no tests and lint is red. | Core billing, routing, agent, and communication flows can regress without a reliable release gate. | Add Node unit tests for pure/server validation, component tests for critical state, and browser tests for sign-in, create/test/publish, call detail, integration failure, and billing. Restore a green lint baseline by separating generated runtime files. | Safer releases and faster engineering feedback. | Medium. | Start now and expand each phase. |
| H3 | Product navigation is local React state inside `/dashboard`; views and selected records have no URLs. Browser Back, refresh, deep links, opening in a new tab, and support links cannot preserve context. | Daily work takes more clicks and support cannot link a customer to the exact problem. | Introduce route-level or query-param state incrementally (`/inbox/:id`, `/agents/:id`, `/contacts/:id`) while preserving current navigation labels. | Predictable navigation and shareable product context. | Medium. | Phase 3/4. |
| H4 | Inbox is a good conversation log viewer but not yet a unified operational inbox: no unread state, assignment, owner, resolution, action-required status, bulk actions, or channel reply composer. | Teams cannot reliably divide and complete daily work. | Add a small status model first: Needs action, Open, Resolved, assigned user/team, unread. Add composing only after channel send contracts are unified. | A real shared workspace rather than a read-only history. | High: requires backend state and permissions. | Phase 3. |
| H5 | Call detail omits recording, sentiment, structured outcome, completed actions, appointments/messages created, integration attempts/failures, customer history, and internal notes. | Users cannot answer "what happened and do I need to act?" in seconds. | Add an outcome header and chronological action timeline. Keep transcript secondary and put diagnostics in an Advanced disclosure. | Faster call review and better follow-up. | Medium to high depending on available runtime data. | Phase 2/3. |
| H6 | Integration setup is a raw webhook editor with no status, last successful action, permission summary, reconnect path, or failure recovery. | Non-technical owners cannot distinguish configured from working. | Create a standard integration state contract and reusable status panel; retain raw webhooks under Advanced. | Higher setup success and fewer support tickets. | High. | Phase 2. |
| H7 | Initial dashboard render sends up to 200 full transcripts, 500 contacts, 200 follow-ups, all agents, channel data, and aggregated insight rows into one client tree even when the user only opens Home. | TTFB, RSC payload, hydration, memory, and search performance degrade as customers grow. | Fetch summaries for Home, paginate Inbox/Contacts server-side, load transcript/detail on selection, and stream route sections. | Faster dashboard and scalable multi-site accounts. | Medium. | Phase 4, with measurements. |
| H8 | Contact name inference/backfill runs during dashboard render and performs per-contact read/ownership/read/update operations. | A page view can trigger an N+1 mutation sequence and delay rendering. | Move enrichment to ingestion/background processing; batch remaining backfills outside the render path. | Faster, side-effect-free dashboard loads. | Medium. | Phase 4. |
| H9 | Pricing describes multi-site customers, and a separate migration contains customers/memberships/roles, but the active portal uses single-owner metadata and has no team, permission, site, or business switcher. | Larger customers cannot safely delegate work or separate locations. | Reconcile the dormant customer schema with the live profile model, then add organisation, site, membership, and role foundations before UI. | Enterprise readiness without cluttering small-business accounts. | High architectural risk. | Planned programme, not a quick UI feature. |
| H10 | Agent status is only `Live`, `Setup`, or `Review`; there is no persisted Draft, Testing, Paused, Error, or Disconnected model, no version history, and no unsaved-change guard. | Users cannot reason about production state or safely experiment. | Add a server-owned lifecycle and versioned configuration; show unsaved/published state and warn before discarding edits. | Safer configuration and clearer production control. | High. | Phase 2. |
| H11 | Conversion is calculated as `(bookingCount + leadCount) / totalCalls`; one call can be both a lead and a booking, so the rate can exceed 100%. | A headline business metric can be wrong, damaging trust. | Count unique calls where either conversion signal is true. Keep bookings and leads as separate counts. | Reliable reporting. | Low. | Fix now. |
| H12 | Navigation contains `/admin/partners`, but no route exists. | Admins encounter a dead product area and the app feels unfinished. | Remove the link until the route exists, or ship the real destination behind a feature flag. | Cleaner navigation and no dead end. | Low. | Fix now. |
| H13 | Authentication expiry is generally returned as "Not signed in" inside local errors; mutations do not consistently redirect or preserve the attempted action. | A long-lived dashboard session can fail in confusing ways and invite duplicate work. | Standardise action errors with an auth-expired code, show a re-auth prompt, and preserve safe draft state. | Clear recovery with less lost work. | Medium. | Phase 2/3. |
| H14 | Home automatically issues up to 12 backfill requests for unanalysed calls after mount. | Opening the dashboard can trigger expensive AI work, duplicate retries across sessions, and unpredictable load. | Move analysis to call completion/queue processing; expose backlog health to admins rather than customer-triggered loops. | Faster Home and predictable processing cost. | Medium. | Phase 4. |
| H15 | Prospect demo links are described as private token URLs sent by SMS, but middleware protects the entire `/demo` prefix and redirects recipients to sign in. The page also links prospects back to the internal demo creator. | The acquisition journey breaks at the moment a prospect tries the personalised demo. | Protect only `/demo/new`, keep token pages public, and remove internal admin navigation from the prospect view. | Personalised demos open directly and feel intentional. | Low. | Fix now. |
| H16 | Every public callback request sends the fixed `profile_slug: "wisecall"`, while personalised demo pages claim the agent was created from the prospect's website. The repository does not show a token-to-live-agent callback path. | Prospects may receive a generic demo after being promised a business-specific one, weakening trust and conversion. | Trace the external callback service, then resolve the demo token to a ready agent or change the page promise until personalised provisioning is real. | The demo experience matches the sales promise. | Medium to high because the external callback/provisioning workflow is outside this repository. | Verify before the next campaign. |
| H17 | Outreach email HTML is assigned into a content-editable element and rendered in a same-origin `srcDoc` iframe without a sanitisation contract. | Malicious stored or pasted markup can become an admin-session XSS path. | Sandbox the preview immediately, then define and enforce one HTML/URL allowlist on paste, save, preview, and send. | Safer outreach authoring without losing rich email formatting. | Low for iframe containment; medium for compatible sanitisation. | Sandbox now; sanitise in the outreach hardening phase. |

## Medium-impact findings

| ID | Current problem | Why it matters | Recommended improvement | Expected user benefit | Development risk | Timing |
| --- | --- | --- | --- | --- | --- | --- |
| M1 | Buttons, fields, badges, cards, alerts, dialogs, and skeletons are hand-styled repeatedly. | Behaviour and accessibility drift even when screens look similar. | Introduce a small internal primitive layer after feature extraction; migrate opportunistically, not in one rewrite. | More consistent and predictable interactions. | Medium. | Phase 4. |
| M2 | Tertiary text is below WCAG contrast on white and many semantic colours bypass tokens. | Metadata and helper text can be hard to read; visual maintenance is inconsistent. | Raise tertiary text contrast, reserve faint colour for placeholders/disabled text, and replace repeated hard-coded values with semantic tokens. | Better accessibility and calmer consistency. | Low. | Phase 4 polish. |
| M3 | `Inter` is loaded into a variable named Geist while the theme requests the literal Geist family. | The intended typography can silently fall back to the system font. | Load Geist consistently or explicitly standardise on Inter. | Stable typography and fewer layout differences. | Low. | Fix now. |
| M4 | Full-screen panels and modals generally lack dialog semantics, focus trapping, focus return, Escape handling, and background inertness. | Keyboard and screen-reader users can lose context or interact behind overlays. | Add one accessible Dialog/Sheet primitive and migrate destructive, preview, support, and editor modals. | Reliable keyboard and assistive-technology use. | Medium. | Phase 4, destructive dialogs earlier. |
| M5 | Form errors rarely use `aria-invalid`, `aria-describedby`, or field-level association; only three live regions exist across 88 controls. | Users may not know which field failed, especially with assistive technology. | Standardise Field, FieldError, and FormStatus patterns. | Faster error recovery and better accessibility. | Low to medium. | Incremental with each workflow. |
| M6 | Contacts show a partial call history, but not a unified chronological timeline across channels, appointments, payments, notes, sentiment, and follow-ups. | Customer context is fragmented and repeat callers are harder to serve. | Build a typed timeline event model and show concise channel/action events with filters. | Better continuity and customer service. | High backend/data risk. | Phase 3. |
| M7 | Dense technical and outbound forms mostly stack responsively, but fixed-height editors/tables and long forms are not broken into mobile priorities. | Mobile users face long scrolling and horizontally constrained controls. | Use mobile summaries plus edit sheets, responsive table-to-list patterns, and sticky final actions. | Better mobile administration without shrinking desktop UI. | Medium. | Phase 3/4 after visual verification. |
| M8 | Billing is visually and navigationally separate from the product shell and repeats full feature lists on every card. | Active customers lose context and plan comparison is denser than necessary. | Put account billing inside the product shell, show current usage/status first, and collapse shared inclusions. | Faster plan decisions and clearer account status. | Low to medium. | Phase 4. |
| M9 | No route has `loading.tsx`; the dashboard waits for all initial work before rendering. | Slow dependencies produce a blank or delayed transition instead of stable app chrome. | Add route-level loading shells and stream independent panels after data is split by route. | Better perceived performance. | Low now, larger benefit after Phase 4. | Later. |
| M10 | Next.js reports the `middleware.ts` convention as deprecated. | It creates upgrade noise and eventually becomes maintenance risk. | Migrate to `proxy.ts` after confirming deployment/runtime behaviour. | Cleaner builds and easier upgrades. | Low. | Maintenance phase. |
| M11 | Several customer-facing surfaces use terms such as PBX, SIP, webhook, DDI, objective tokens, and provisioning without a plain-English first layer. | Non-technical owners can misconfigure advanced features. | Keep technical controls under Advanced and lead with outcome language, examples, and safe defaults. | More successful self-serve setup. | Low to medium. | Phase 2/4. |
| M12 | Integration header values are returned to the browser as editable plain values. | API keys are more exposed than necessary and are easy to overwrite accidentally. | Store secrets separately/encrypted, return masked metadata, and use replace-secret interactions. | Better credential hygiene. | High migration risk. | Phase 2 architecture. |

## Minor polish

| ID | Current problem | Why it matters | Recommended improvement | Expected user benefit | Development risk | Timing |
| --- | --- | --- | --- | --- | --- | --- |
| P1 | Reduced-motion CSS disables entrance transforms but not all pulsing, pinging, live-dot, and shimmer animations. | Some motion remains for users who requested less. | Disable nonessential repeated animation under `prefers-reduced-motion`. | More comfortable accessible UI. | Low. | Polish pass. |
| P2 | Icon-only buttons are mostly labelled, but tooltip behaviour is inconsistent and native `title` is used selectively. | Unfamiliar actions are less discoverable. | Add a shared tooltip for non-obvious icon controls. | Better discoverability without extra visible text. | Low. | Component pass. |
| P3 | Branding is reimplemented as text, image-plus-text, SVG owl, and email markup across surfaces. | Small spacing and typography differences reduce polish. | Create web and email-safe brand lockups with explicit size variants. | More consistent product identity. | Low. | Polish pass. |

## Area-by-area assessment

| Area | Current assessment | Priority direction |
| --- | --- | --- |
| Navigation and IA | Clear five-item daily navigation; local-state routing and one dead admin link are the main problems. | Preserve labels; add real URLs incrementally. |
| Dashboard | Strongest customer surface; outcome-led, calm, and mostly well prioritised. | Correct metrics, surface partial failures, reduce payload. Do not redesign. |
| Agent setup | Helpful website-first wizard with good plain-English structure. Activation semantics and network fetch safety need immediate correction. | Safety first, then real draft/test/publish states. |
| Agent configuration | Friendly sections exist, but Office Hours and Routing sit above every tab, while raw prompt/technical controls remain prominent. | Move production status to a compact header and advanced controls behind disclosure. |
| Call detail | Summary and transcript are readable; operational outcome and action evidence are incomplete. | Outcome header plus action timeline. |
| Unified Inbox | Good responsive list/detail foundation; lacks team workflow state and replying. | Add action status/assignment before more channels. |
| Contacts | Useful notes and inferred identity; history is partial and labelled as calls even for other channels. | Unified timeline and contact-to-conversation links. |
| Integrations | Powerful low-level webhook capability; weak reliability/status experience. | Standard integration contract, health, tests, logs, fallback. |
| Phone system | PBX registration states are clearer than most integrations; provider-managed fields and destructive removal need hardening. | Read-only assigned numbers, confirmed removal, plain-English setup. |
| Reporting | Dashboard tells a useful business story; conversion correctness and analysis processing need work. | Correct math, data freshness, export/comparison later. |
| Billing and usage | Commercial information is present; account status and usage are split across Billing and Channels. | Current plan/usage first, shared inclusions collapsed. |
| Team and permissions | Not implemented in the active model. | Architectural programme before UI. |
| Multi-site | Agents can represent businesses, but there is no organisation/site hierarchy or switcher. | Build on membership/site model, then add contextual switcher. |
| Mobile | Inbox/Contacts use sensible list/detail adaptation; dense forms and modal accessibility need browser verification. | Verify at 390, 768, 1024, and desktop after each phase. |
| Accessibility | Reduced motion and many labels exist; focus, dialogs, field errors, and contrast are inconsistent. | Primitive-level fixes plus keyboard browser tests. |
| Performance | Parallel server fetching is good; payload size, render-time mutation, client monolith, and analysis backfill are not scalable. | Route/data split, pagination, background jobs, measurement. |

## Controlled implementation roadmap

### Phase 1 - Trust and correctness (current branch)

- Secure public website fetching and add unit tests.
- Stop customers mutating assigned numbers/live state through generic settings.
- Remove authenticated demo-data fallback.
- Propagate and display partial dashboard load failures.
- Correct conversion-rate double counting and test the calculation.
- Remove the dead Partners navigation link.
- Protect internal prospect-demo creation at both page and API boundaries.
- Restore public token-demo access while keeping the creator admin-only.
- Validate every post-authentication redirect as an internal path.
- Sandbox rich-email previews pending a shared HTML sanitisation policy.
- Fix the Geist font baseline.
- Update onboarding copy so the final activation consequence is explicit.

Release gate: typecheck, unit tests, production build, lint delta review, and authenticated desktop/mobile browser verification.

### Phase 2A - Visible workflow refinement (current branch)

- Simplify agent configuration into Setup, Knowledge, Routing, Outbound, and Advanced.
- Keep live phone state visible in a compact summary instead of showing routing controls above every tab.
- Move office hours into Setup and number management into Routing.
- Remove duplicated billing information from agent configuration.
- Track unsaved changes per agent and use one truthful save state for voice, availability, routing, and advanced settings.
- Lead call detail with outcome, follow-up requirement, and handling agent.
- Merge duplicate summaries and keep the full transcript available behind progressive disclosure.

Release gate: targeted lint, typecheck, unit tests, production build, and authenticated responsive browser verification.

### Phase 2B - Integration trust and operational state (current branch)

- Validate enabled integration endpoints and reject local, private, credential-bearing, or non-standard-port URLs.
- Apply the same public-network and redirect checks inside the voice runtime so older stored configuration cannot bypass the portal guard.
- Add a server-owned test workflow with non-customer sample data and persisted pass/fail evidence.
- Invalidate stale test evidence whenever an integration's execution settings change.
- Collapse integration configuration into status-led rows with explicit Not tested, Test passed, Test failed, and Disabled states.
- Distinguish Live, Paused, Setting up, Needs review, and Not connected using the active profile and phone route together.
- Stop dashboard contact-name repair from calling `revalidatePath` during render and triggering the route error boundary.

Remaining limitation: integration status currently represents the last explicit portal test, not continuous uptime or real-call delivery history. Runtime delivery events need a dedicated event store before the UI can claim live health.

### Phase 2 - Production state and integrations

- Persist Draft, Testing, Live, Paused, Error, and Disconnected states.
- Separate provisioning from publishing and add version history/rollback.
- Standardise integration status, test, reconnect, logs, fallback, and secret handling.
- Persist call action/integration outcomes.
- Add outbound review, limits, consent, idempotency, and failure recovery.

### Phase 3 - Daily operations

- Add inbox status, unread, assignment, resolution, and follow-up ownership.
- Redesign call detail around outcome and actions while preserving transcript access.
- Add a unified contact timeline and cross-links.
- Verify and refine mobile daily workflows.

### Phase 4 - Performance, architecture, and design system

- Introduce route-level navigation and lazy detail loading.
- Paginate Inbox and Contacts; remove transcripts from initial dashboard payload.
- Move enrichment and analysis backfills off the render path.
- Extract feature modules and a small accessible primitive set.
- Resolve lint debt, contrast, focus, dialogs, billing shell, and remaining visual consistency.

### Phase 5 - Organisation and multi-site foundations

- Reconcile customer/membership schema with live profile ownership.
- Add organisations, sites, roles, invitations, audit logs, and scoped views.
- Add enterprise reporting and administration only after isolation and permission tests pass.

## Verification still required

- Authenticated production walkthrough at desktop, tablet, and mobile widths.
- Real first-agent creation to confirm exact activation/provisioning timing for both Telnyx and MOR paths.
- Integration failure walkthrough with customer-interaction fallback.
- Outbound worker and compliance flow trace; the processing worker is not present in this repository.
- Staging RLS dependency audit for every service that reads `wisecall_profiles`.
- Performance trace with a large real account, including RSC payload size, server timing, and client interaction latency.
