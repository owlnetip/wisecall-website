# WiseCall SEO: What To Do Next

This is the plain-English checklist to follow after the first SEO architecture pass.

## 1. Deploy the current site

Deploy the site so the new routes are live:

- `/industries/dental/`
- `/industries/legal/`
- `/industries/estate-agents/`
- `/pricing/`
- `/how-it-works/`
- `/compare/ai-receptionist-uk-comparison/`
- `/resources/missed-call-calculator/`
- `/resources/call-transcript-guide/`
- `/blog/missed-calls-cost-uk-businesses/`
- `/integrations/`
- `/case-studies/`

After deploy, open the live URL and check that old pages redirect:

- `/dental` should go to `/industries/dental/`
- `/legal` should go to `/industries/legal/`
- `/property` should go to `/industries/estate-agents/`

## 2. Submit the sitemap

Submit this URL in Google Search Console and Bing Webmaster Tools:

`https://wisecall.io/sitemap.xml`

Also check:

- `https://wisecall.io/robots.txt`
- `https://wisecall.io/llms.txt`

## 3. Add tracking IDs

Do not add fake IDs. Create the real accounts first, then add:

- Google Search Console verification
- Bing Webmaster Tools verification
- GA4 Measurement ID

Recommended events:

- `demo_booking_click`
- `contact_form_submit`
- `missed_call_calculator_used`
- `pricing_cta_click`
- `industry_demo_click`
- `call_source_landing_page`

## 4. Replace placeholders with real proof

The site now has safe placeholders for case studies, call samples and transcript-derived content. Only replace them when you have real approved material.

Gather:

- one anonymised dental call example
- one anonymised legal intake example
- one anonymised estate agency enquiry example
- verified before/after metrics if available
- written permission before naming any customer

Do not invent testimonials, case studies, ratings or customer numbers.

## 5. Improve the first blog post

The missed-calls blog post is live as a first SEO target. Next, strengthen it with:

- UK business examples
- a short section for dental practices
- a short section for law firms
- a short section for estate agents
- links back to the three industry pages
- real WiseCall aggregate data when enough data exists

## 6. Next pages to add

Once the first pages are indexed, add one page at a time:

1. `/industries/restaurants/`
2. `/industries/schools/`
3. `/industries/telecoms-reseller/`
4. `/features/out-of-hours-answering/`
5. `/features/call-summary/`
6. `/features/appointment-booking/`

Use the existing config in `scripts/seo-content.mjs` rather than making separate hand-coded pages.

## 7. Monthly maintenance

Every month:

- check Search Console query data
- improve pages that get impressions but low clicks
- add FAQs from real sales calls
- add internal links to pages that are underperforming
- update `llms.txt` when important pages are added
- validate schema on key pages

## 8. Best next Codex task

Ask Codex:

> Build the `/industries/restaurants/` page using the existing SEO generator and content architecture. Do not invent customer data. Add only sector-specific FAQs, pain points, integrations and CTAs.
