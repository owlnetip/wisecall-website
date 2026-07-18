# WiseCall SEO & Paid Ads Tracking Setup

These IDs are intentionally not hardcoded into the website source. They are injected at build time from Vercel environment variables.

## Environment variables (Vercel marketing site)

```
WISECALL_META_PIXEL_ID=your_meta_pixel_id
WISECALL_GA4_ID=G-XXXXXXXXXX
```

The build runs `npm run inject:analytics-config`, which writes meta tags into:

- `/dental.html`
- `/try-demo/index.html`

Client-side tracking lives in `/public/wisecall-analytics.js` (served as `/wisecall-analytics.js`).

## Manual setup required

- Create Meta Business Manager and a Pixel in Events Manager
- Create GA4 property (optional but recommended)
- Set the env vars above in Vercel and redeploy
- Verify events with Meta **Test Events** and GA4 **DebugView**
- Add Google Search Console verification token once the property is created
- Add Bing Webmaster Tools verification token once the Bing property is created

## Conversion events

| Event | When it fires |
|---|---|
| `demo_call_click` | User taps a `tel:` demo link |
| `demo_callback_requested` | Desktop “Call me” demo succeeds |
| `pilot_cta_click` | “Start a 7-day pilot” clicked |
| `contact_form_submit` | Dental demo contact form sent |
| `missed_call_calculator_used` | Calculator first interaction (`/dental`) |

UTM parameters (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `fbclid`) are captured on landing and:

- Appended to pilot signup URLs automatically
- Sent with demo callback API payloads
- Included in Meta / GA4 event parameters

## Ad landing pages

| URL | Use |
|---|---|
| `https://wisecall.io/try-demo/` | Primary Meta ad destination (stripped, demo-first) |
| `https://wisecall.io/dental/` | Retargeting, broader dental intent |

Example ad URL:

```
https://wisecall.io/try-demo/?utm_source=meta&utm_medium=paid&utm_campaign=uk_dental_demo_v1&utm_content=call_it_now
```

See `docs/meta-ads-uk-dental-test-plan.md` for the full 30-day test plan.

## Verification

- **Meta:** Events Manager → Test Events → open `/try-demo/` and trigger demo click
- **GA4:** Admin → DebugView (if GA4 ID set)
- **Google Search Console:** verify domain, submit `https://wisecall.io/sitemap.xml`
- **Bing Webmaster Tools:** verify domain, submit sitemap

## Related legacy event names (GA4 recommended aliases)

- `demo_booking_click`
- `industry_demo_click`
- `pricing_cta_click`
- `call_source_landing_page`

These can be mapped in GA4 admin if you prefer the older naming in reports.
