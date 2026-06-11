# WiseCall SEO Tracking Setup

These placeholders are intentionally not hardcoded into the website because the production IDs are not available yet.

## Manual setup required

- Add Google Search Console verification token in production once the property is created.
- Add Bing Webmaster Tools verification token once the Bing property is created.
- Add GA4 measurement ID through an environment variable or deployment setting, not a fake hardcoded ID.
- Track demo booking clicks and successful form submissions as conversion events.
- Track call source and landing page source through hidden form fields and CRM fields.

## Recommended event names

- demo_booking_click
- contact_form_submit
- missed_call_calculator_used
- pricing_cta_click
- industry_demo_click
- call_source_landing_page

## Verification

- Google Search Console: verify the domain property, then submit https://wisecall.io/sitemap.xml
- Bing Webmaster Tools: verify the domain property, then submit https://wisecall.io/sitemap.xml
- GA4: add the Measurement ID through the deployment environment or a safe config injection step.
