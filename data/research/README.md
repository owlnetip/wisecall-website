# Dental marketing research (York + Leeds + more)

Research lists for WiseCall outbound blasts targeting dental practices by UK postcode region.

**Where everything lives:**

| Location | What's there |
|----------|----------------|
| `data/research/` | Master CSVs, outbound blast CSVs, region configs, ADG/BDA flags |
| `data/research/regions/*.json` | Per-city postcode + core area config |
| `scripts/build-dental-marketing-list.py` | Regenerate lists + website PMS scan |
| `apps/portal/src/data/dental-prospects-seed.json` | Dentally Tier 1 independents bundled for CRM import |
| **Admin portal → `/admin/outreach`** | CRM to track sends, draft emails, 3/7/14-day follow-ups |

| Region | Postcodes | Master list | Tier 1 independents (Dentally) |
|--------|-----------|-------------|--------------------------------|
| **York** | YO* | `york-yo-dental-marketing-list.csv` (108) | 6 |
| **Leeds** | LS* | `leeds-ls-dental-marketing-list.csv` (182) | 7 |
| **Harrogate** | HG* | `harrogate-hg-dental-marketing-list.csv` | (run build) |
| **Bradford** | BD* | `bradford-bd-dental-marketing-list.csv` | (run build) |
| **Hull** | HU* | `hull-hu-dental-marketing-list.csv` | (run build) |
| **Sheffield** | S* | `sheffield-s-dental-marketing-list.csv` | (run build) |

Add more cities by creating a JSON config in `data/research/regions/` and running the build script.

## Important limitation

There is **no public directory** of UK practices using **Dentally** or **Exact (Software of Excellence)**. This research infers practice management software (PMS) from public signals — mainly online booking links on practice websites:

| PMS | Typical public fingerprint |
|-----|---------------------------|
| **Dentally** | `*.portal.dental`, legacy `*.dentr.net` |
| **Exact / SOE** | `onlineappointments.co.uk`, SOE-branded booking pages |

Anything marked **Unknown PMS** still has value for a general dental blast, but you should qualify PMS on the call before pitching Dentally live booking.

## Files

### Shared

| File | Purpose |
|------|---------|
| `regions/york.json` / `regions/leeds.json` | Region config (postcodes, core area, area labels) |
| `adg-corporate-groups.json` | ADG member match patterns |
| `york-dental-manual-overrides.json` | York verified manual enrichments |
| `leeds-dental-manual-overrides.json` | Leeds verified manual enrichments (empty starter) |

### York (YO)

| File | Purpose |
|------|---------|
| `york-yo-dental-marketing-list.csv` | Full master list (108 practices) |
| `york-yo-dental-dentally-tier1-independents-outbound.csv` | **Start here** — 6 independent Dentally targets with phones |
| `york-yo-dental-dentally-tier1-blast-outbound.csv` | All Tier 1 Dentally (incl. corporate) |
| `york-yo-dental-york-core-independents-outbound.csv` | York city + inner YO postcodes, non-ADG |
| `york-yo-dental-york-core-bda-good-practice-outbound.csv` | York core BDA Good Practice members |
| `york-yo-dental-dentally-contacts.csv` | Owner/decision-maker research for York Tier 1 |

### Leeds (LS)

| File | Purpose |
|------|---------|
| `leeds-ls-dental-marketing-list.csv` | Full master list (182 practices) |
| `leeds-ls-dental-dentally-tier1-independents-outbound.csv` | **Start here** — 7 independent Dentally targets with phones |
| `leeds-ls-dental-dentally-tier1-blast-outbound.csv` | All Tier 1 Dentally (incl. corporate) |
| `leeds-ls-dental-leeds-core-independents-outbound.csv` | Leeds city + inner LS postcodes, non-ADG (92) |
| `leeds-ls-dental-leeds-core-bda-good-practice-outbound.csv` | Leeds core BDA Good Practice members (7) |
| `leeds-ls-dental-leeds-core-unknown-pms-outbound.csv` | Leeds core unknown PMS — qualification calls (98) |

## Industry association flags

The build script tags each practice using:

| Flag | Source | Meaning |
|------|--------|---------|
| `adg_corporate` | [ADG members](https://www.theadg.co.uk/members/) | Corporate dental group (mydentist, Smile Dental Care, Genix, Bupa, etc.) → Tier 4 |
| `bda_good_practice` | [BDA Good Practice map](https://www.bda.org/learning/bda-good-practice/find-a-good-practice/) | Quality charter member (~975 UK practices) |

BDA list is downloaded to `bda-good-practice.kml` on first run. Regenerate flags only (fast):

```bash
python3 scripts/build-dental-marketing-list.py --region york --skip-website-scan
python3 scripts/build-dental-marketing-list.py --region leeds --skip-website-scan
```

## WiseCall tiers

- **Tier 1** — Dentally confirmed/likely → pitch live Dentally booking on calls
- **Tier 2** — Exact/SOE confirmed → workflow/summary pitch (no live Dentally booking yet)
- **Tier 3** — Unknown PMS → qualify first
- **Tier 4** — ADG corporate groups or mydentist → lower priority

## Regenerating

```bash
# Full rebuild with website PMS scan
python3 scripts/build-dental-marketing-list.py --region leeds
python3 scripts/build-dental-marketing-list.py --region york

# York-only wrapper (same as --region york)
python3 scripts/build-york-dental-marketing-list.py
```

On first run the script downloads the latest CQC directory CSV (~19MB) into this folder.

### Leeds Tier 1 independents (July 2026 scan)

| Practice | Area | Phone |
|----------|------|-------|
| The Dental Architect | LS1 city centre | 01138 684324 |
| The Tooth Spa | LS7 Chapel Allerton | 01132 625545 |
| Chelwood Dental Care | LS8 Roundhay | 01132 668459 |
| Church View Dental Care | LS15 Cross Gates | 01132 647133 |
| Manor Square Dental | LS21 Otley | 01943 461501 |
| Glen Lea Dental Suite | LS22 Wetherby | 01937 583502 |
| Ilkley Dental Studio | LS29 Ilkley | 0798 4005132 |

Genix Healthcare (2 Leeds sites) also runs Dentally but is ADG corporate → Tier 4.

## Portal outbound upload

Use any `*-outbound.csv` in the portal **Outbound** tab. Columns:

- `phone` — auto-detected as the number column
- `name` — contact/practice name
- Merge fields: `{{company}}`, `{{postcode}}`, `{{pms}}`, `{{segment}}`, `{{tier}}`

### Suggested Dentally blast objective (Tier 1)

> Hi, this is WiseCall calling {{company}} in {{postcode}}. We work with Dentally practices to answer patient calls 24/7 and book appointments straight into your Dentally diary — same as your online portal, but over the phone. Is the practice manager or lead dentist available for a two-minute overview?

### Suggested qualification blast (Tier 3 / York core unknown)

> Hi, this is WiseCall calling {{company}}. We help dental practices never miss new patient or emergency calls — with summaries your team can action when they're back at the desk. Quick question: what practice software do you use for your diary — Dentally, Exact, or something else?

## Data sources

- [CQC care directory CSV](https://www.cqc.org.uk/about-us/transparency/using-cqc-data) — filtered to `Dentist` + `YO*` postcodes
- Practice website scans (July 2026)
- Manual verification for Dentally portal links

| `york-dental-manual-overrides.json` | Verified manual enrichments |

## FullEnrich API enrichment

Once you have a FullEnrich API key, run:

```bash
export FULLENRICH_API_KEY=your_key_here
python3 scripts/enrich-dental-contacts.py
```

This will:

1. Read the 6 Dentally-confirmed decision-makers from `york-yo-dental-dentally-contacts.csv`
2. Submit a bulk enrichment job to FullEnrich (work email, personal email, mobile)
3. Poll until results are ready (~30–90 seconds per contact)
4. Write:
   - `york-yo-dental-dentally-enriched.csv` — full results with email status + mobile
   - `york-yo-dental-dentally-enriched-outbound.csv` — portal-ready with `phone`, `email`, `mobile`, `channel`

Manual input reference (if uploading via FullEnrich UI instead): `york-yo-dental-dentally-fullenrich-input.csv`

**Do not commit your API key.** Pass it via environment variable only.

If enrichment returns mobiles, still prefer **phone outbound over SMS** for cold outreach (see email reality check below).

## Email reality check (Dentally-confirmed 6)

There are **no public owner/director personal emails** for these practices. What exists is pooled:

| Practice | Public email | Useful for owner outreach? |
|----------|--------------|----------------------------|
| Castlegate | castlegatedentalreception@gmail.com | No — shared Gmail inbox |
| Heslington | info@heslingtondental.co.uk | No |
| Blossom | info@ / membership@blossomdentalcare.co.uk | No |
| Ainsty | mail@ainstydental.co.uk | No |
| Smile Care York | customerservice@smiledentalcare.co.uk | No — corporate |
| Stamford Bridge | care@stamfordbridgedental.com | No |

**Recommendation:** use the phone outbound list and ask for the named owner/practice manager (see `york-yo-dental-dentally-contacts.csv`). Email blast to these addresses will almost certainly hit reception and go nowhere.

These are business phone numbers from public CQC/register sources. Run outbound only within UK calling hours, honour opt-outs, and maintain your DNC list in the portal before blasting.

## Admin outreach CRM

Import Dentally Tier 1 independents into the admin portal and track personalized email outreach:

1. Apply migration `apps/portal/supabase/migrations/0017_outreach_crm.sql` in Supabase
2. Set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` on the portal (Vercel env)
3. Optional: set `CRON_SECRET` for automatic daily follow-up processing (9:00 UTC cron)
4. Open **`/admin/outreach`** → **Import Dentally list**
5. Select a practice, add the recipient email, pick a template, personalize, send

After the initial email, follow-ups auto-schedule for **day 3, 7 and 14**. Mark a prospect **Not interested** or **Paused** to stop the sequence. After day 14 the sequence completes unless they reply.

Regenerate the CRM seed after adding regions:

```bash
python3 scripts/sync-dental-prospects-seed.py
```
