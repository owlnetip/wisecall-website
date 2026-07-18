# UK Dental Meta Ads — 30-Day Test Plan

Prepared for WiseCall paid social launch. Landing pages: `/try-demo/` (primary for ads) and `/dental/` (retargeting / broader intent).

## Budget

| Phase | Spend | Goal |
|---|---|---|
| **Month 1 (learn)** | **£4,000** (~£110/day) | Cost per demo call, winning creative |
| Month 2 (optimise) | £5k–£10k | Cost per pilot enquiry, retargeting |
| Month 3+ (scale) | £10k+ | Only after 2–3 testimonials and proven CPA |

Testimonials are **not required to start**, but collect 2–3 during month 1 before scaling past £10k/month.

## Pre-flight checklist

- [ ] Create Meta Business Manager + ad account
- [ ] Create Meta Pixel in Events Manager
- [ ] Set `WISECALL_META_PIXEL_ID` in Vercel (marketing site project)
- [ ] Optional: set `WISECALL_GA4_ID` for GA4
- [ ] Redeploy site (runs `inject:analytics-config` on build)
- [ ] Verify events in Meta Events Manager Test Events tool
- [ ] Confirm demo callbacks are answered within 60 seconds (Mon–Fri 8am–6pm)

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

## Campaign structure (Month 1)

```
Campaign: WC_UK_Dental_Demo_v1
├── Ad set A: Practice owners (dentist, dental practice owner)
├── Ad set B: Practice managers / admins
└── 5 creatives × 2 ad sets
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

## Kill / scale rules (after 500+ impressions per ad)

| Signal | Action |
|---|---|
| Zero demo clicks | Pause ad |
| CPC > £3, no engagement | Pause ad |
| One ad 2× better CTR | Shift 60% budget to winner |
| <10 demo calls in month | New creatives, don’t increase spend |
| 20+ demos, 3+ pilot leads | Increase to £150–200/day month 2 |

## Month 1 success targets

| Metric | Conservative | Good |
|---|---|---|
| Demo call clicks | 40–80 | 100+ |
| Completed demo calls | 15–30 | 40+ |
| Pilot enquiries | 2–5 | 8+ |
| Cost per demo call | £80–£150 | <£60 |

## Competitor monitoring (optional)

Weekly manual check: [Meta Ad Library — search “fonio”](https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=GB&media_type=all&q=fonio&search_type=keyword_unordered) (GB filter).

Save new creatives and landing page URLs; note hooks used in first 3 seconds.

## Related files

- `/public/wisecall-analytics.js` — client-side tracking
- `/scripts/inject-analytics-config.mjs` — injects pixel IDs at build
- `/try-demo/index.html` — ad landing page
- `/dental.html` — full vertical page with tracking
