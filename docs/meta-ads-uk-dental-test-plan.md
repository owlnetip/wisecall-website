# UK Dental Acquisition Plan — Ads, Outbound & Budget Strategy

Prepared for WiseCall dental growth. Covers **how to spend acquisition money well**, not just how to run ads. Landing pages: `/try-demo/` (primary for ads) and `/dental/` (retargeting / broader intent).

---

## TL;DR — should we spend £4–5k/month on Meta?

**Not cold, and not first.** WiseCall already owns the asset most startups buy ads to build: **~10,830 researched dental prospects + email sequences + AI outbound calling** (see `data/research/`, `apps/portal` outreach CRM). Paying £5k/month to *find* dental practices you already have contact details for is spending twice.

Cold Meta is also **harder for WiseCall than for Fonio**: Fonio converts cold traffic because their offer is low-commitment (self-serve, ~€300, originally pay-per-use). WiseCall asks for a **7-day pilot → 12-month term** — a considered B2B purchase that humans close far better than cold ads.

**Recommendation:** sequence the spend. Work the warm list first (near-free), add a small ad budget for retargeting + creative testing, and only scale ads once you have testimonials and a proven cost per signup.

---

## Unit economics (do this math before spending anything)

| Metric | Business (£399/mo) | Blended (~£220 avg)* |
|---|---|---|
| Revenue over 12-month term | £4,788 | £2,640 |
| Contribution at ~55% margin† | ~£2,600 | ~£1,450 |
| **Max healthy CAC (LTV:CAC 3:1)** | **~£850** | **~£480** |

\* Realistic mix of Starter £99 / Professional £199 / Business £399.  
† **Margin is the critical unknown** — AI voice + telephony have real per-minute COGS. Confirm true contribution margin before scaling any channel.

**Framing correction:** you do **not** need 15 signups in month one to "profit." Revenue recurs — each Business customer is worth ~£4,788 over the term. **3–4 signups/month is real, compounding recurring revenue.** Spend pays back over the term, not the calendar month — *provided retention and margin hold and CAC stays below the ceiling above.*

---

## Channel comparison for £4–5k/month

| Option | What it buys | Realistic early signups | Est. CAC | Trade-offs |
|---|---|---|---|---|
| **Cold Meta only** | ~£110/day + creative | 1–3/mo (month 1–2) | £1,300–4,000 | Builds pixel/retargeting asset; unprofitable while learning; compounds later |
| **Salesperson / SDR** | 1 junior UK rep or commission deal | 3–6/mo after ramp | £700–1,700 | Works the *warm* list, gathers testimonials + product feedback; mgmt overhead, ramp, single point of failure |
| **Hybrid (recommended)** | Founder/1 person selling + outbound + £1–1.5k Meta | 4–8/mo | £500–1,100 | Uses paid-for leads, small ads warm brand + feed retargeting, produces testimonials that unlock scaled ads |

**On hiring:** a salesperson is likely a better use of £4–5k than cold ads *right now* because the leads are warm — but don't hire until the founder has closed the first handful personally and proven the pitch is repeatable. Then hire to scale what works.

---

## Phased plan (spend in this order)

### Phase 0 — Work the warm list (now, ~£0–500/mo)
The highest-ROI money because the leads are already paid for.

- Run the existing dental email sequences (Resend day 0 → 3 → 7 → 14) against the researched list.
- Layer AI outbound calls to opens/clicks and high-fit practices.
- Founder (or one person) personally closes — book demos, run the 7-day pilot.
- **Goal: first 5–10 paying customers + 3 named testimonials.**
- Cost is mostly time + minimal telephony/email.

### Phase 1 — Small paid test + retargeting (£1–1.5k/mo)
Not primary acquisition — brand warming, pixel data, creative learning.

- Install Meta Pixel (already wired — see below), start collecting audiences.
- **Retarget** website visitors and lead-list engagers (warm > cold).
- Test 3–5 creatives to learn which hooks work, cheaply.
- Point ads at `/try-demo/`.

### Phase 2 — Scale Meta (£4–5k+/mo) — GATED
Only unlock when **all** of these are true:

- [ ] 3+ named testimonials collected (from Phase 0)
- [ ] True contribution margin confirmed
- [ ] Known cost per demo call from Phase 1
- [ ] Outbound list is maxed (diminishing returns on warm leads)
- [ ] Demo callbacks reliably answered within 60s during ad hours

If those hold, scale using the campaign structure and kill/scale rules below.

---

## Pre-flight checklist (before any paid spend)

- [ ] Create Meta Business Manager + ad account
- [ ] Create Meta Pixel in Events Manager
- [ ] Set `WISECALL_META_PIXEL_ID` in Vercel (marketing site project)
- [ ] Optional: set `WISECALL_GA4_ID` for GA4
- [ ] Redeploy site (runs `inject:analytics-config` on build)
- [ ] Verify events in Meta Events Manager Test Events tool
- [ ] Confirm demo callbacks are answered within 60 seconds (Mon–Fri 8am–6pm)
- [ ] Confirm contribution margin so CAC ceiling is real, not assumed

### Vercel environment variables

```
WISECALL_META_PIXEL_ID=your_pixel_id
WISECALL_GA4_ID=G-XXXXXXXXXX
```

Build command should include analytics injection (see root `package.json`):

```bash
npm run inject:analytics-config && npm run build
```

Or set Vercel **Build Command** to that string.

---

## Tracked conversion events

| Event | When | Meta use |
|---|---|---|
| `demo_call_click` | User taps `tel:+441135222277` | Optimise / custom conversion |
| `demo_callback_requested` | Desktop “Call me” succeeds | Optimise / custom conversion |
| `pilot_cta_click` | “Start a 7-day pilot” clicked | Secondary conversion |
| `missed_call_calculator_used` | Calculator interacted (`/dental` only) | Engagement signal |
| `contact_form_submit` | Dental demo form sent | Lead signal |

UTM parameters from ads are stored in `sessionStorage` and appended to pilot signup URLs automatically.

## Ad destination URLs

**Primary (stripped LP):**

```
https://wisecall.io/try-demo/?utm_source=meta&utm_medium=paid&utm_campaign=uk_dental_demo_v1&utm_content={{ad.name}}
```

**Retargeting / comparison:**

```
https://wisecall.io/dental/?utm_source=meta&utm_medium=paid&utm_campaign=uk_dental_retarget_v1
```

## Campaign structure (Phase 2 scale)

```
Campaign: WC_UK_Dental_Demo_v1
├── Ad set A: Practice owners (dentist, dental practice owner)
├── Ad set B: Practice managers / admins
├── Ad set C: Retargeting (site visitors + lead-list engagers)
└── 5 creatives × ad set
```

**Geo:** United Kingdom only  
**Age:** 25–65  
**Placements:** Advantage+ (review Reels vs Feed after 7 days)  
**Optimisation:** Landing page views (days 1–3) → `demo_call_click` custom conversion (day 4+)

## Five ad scripts (15–30 sec, vertical 9:16)

1. **Call it now** — reception busy, WiseCall answers, CTA call demo
2. **Missed call maths** — 10 missed calls/week × £200
3. **Out of hours** — weekend calls, summary at 8am
4. **Reception overflow** — not replacing staff, catching overflow
5. **Founder direct** — Luke/team, “call the demo, 60 seconds”

Once you have testimonials (Phase 0), add a 6th quote-led creative.

## Kill / scale rules (after 500+ impressions per ad)

| Signal | Action |
|---|---|
| Zero demo clicks | Pause ad |
| CPC > £3, no engagement | Pause ad |
| One ad 2× better CTR | Shift 60% budget to winner |
| <10 demo calls in month | New creatives, don’t increase spend |
| CAC above the ceiling (see unit economics) for 2+ weeks | Pause scaling, fix funnel or margin |
| 20+ demos, 3+ pilot leads, CAC under ceiling | Increase to £150–200/day |

## Success targets (per £1k/mo of paid, cold traffic)

| Metric | Conservative | Good |
|---|---|---|
| Demo call clicks | 10–20 | 25+ |
| Completed demo calls | 4–8 | 10+ |
| Pilot enquiries | 0.5–1.5 | 2+ |
| Cost per demo call | £80–£150 | <£60 |

Warm retargeting and outbound-sourced signups should beat these materially — that's the point of sequencing.

## Competitor monitoring (optional)

Weekly manual check: [Meta Ad Library — search “fonio”](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&media_type=all&q=fonio&search_type=keyword_unordered) (GB filter).

Save new creatives and landing page URLs; note hooks used in first 3 seconds.

## Related files

- `/public/wisecall-analytics.js` — client-side tracking
- `/scripts/inject-analytics-config.mjs` — injects pixel IDs at build
- `/try-demo/index.html` — ad landing page
- `/dental.html` — full vertical page with tracking
- `data/research/` + `apps/portal` outreach CRM — the warm dental list to work in Phase 0
