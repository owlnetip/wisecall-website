# York (YO) dental marketing research

Research list for WiseCall outbound blasts targeting dental practices in the York / North Yorkshire **YO** postcode area.

## Important limitation

There is **no public directory** of UK practices using **Dentally** or **Exact (Software of Excellence)**. This research infers practice management software (PMS) from public signals — mainly online booking links on practice websites:

| PMS | Typical public fingerprint |
|-----|---------------------------|
| **Dentally** | `*.portal.dental`, legacy `*.dentr.net` |
| **Exact / SOE** | `onlineappointments.co.uk`, SOE-branded booking pages |

Anything marked **Unknown PMS** still has value for a general dental blast, but you should qualify PMS on the call before pitching Dentally live booking.

## Files

| File | Purpose |
|------|---------|
| `york-yo-dental-marketing-list.csv` | Full master list (108 practices) with PMS signals, tiers, notes |
| `york-yo-dental-dentally-tier1-blast-outbound.csv` | **Start here** — Dentally confirmed/likely + phone numbers |
| `york-yo-dental-dentally-confirmed-outbound.csv` | High-confidence Dentally only |
| `york-yo-dental-york-core-all-outbound.csv` | York city + inner YO postcodes (YO1, YO10, YO19, YO23–YO32, YO41) |
| `york-yo-dental-york-core-independents-outbound.csv` | York core excluding ADG corporate groups |
| `york-yo-dental-york-core-bda-good-practice-outbound.csv` | York core BDA Good Practice charter members |
| `york-yo-dental-york-core-unknown-pms-outbound.csv` | York core practices where PMS is unknown — good for qualification calls |
| `york-yo-dental-dentally-tier1-independents-outbound.csv` | Tier 1 Dentally targets excluding ADG corporate |
| `york-yo-dental-dentally-contacts.csv` | Owner/decision-maker research — public emails, names, outreach channel |
| `adg-corporate-groups.json` | ADG member match patterns |
| `york-dental-manual-overrides.json` | Verified manual enrichments |

## Industry association flags

The build script tags each practice using:

| Flag | Source | Meaning |
|------|--------|---------|
| `adg_corporate` | [ADG members](https://www.theadg.co.uk/members/) | Corporate dental group (mydentist, Smile Dental Care, Genix, Bupa, etc.) → Tier 4 |
| `bda_good_practice` | [BDA Good Practice map](https://www.bda.org/learning/bda-good-practice/find-a-good-practice/) | Quality charter member (~975 UK practices) |

BDA list is downloaded to `bda-good-practice.kml` on first run. Regenerate flags only (fast):

```bash
python3 scripts/build-york-dental-marketing-list.py --skip-website-scan
```

## WiseCall tiers

- **Tier 1** — Dentally confirmed/likely → pitch live Dentally booking on calls
- **Tier 2** — Exact/SOE confirmed → workflow/summary pitch (no live Dentally booking yet)
- **Tier 3** — Unknown PMS → qualify first
- **Tier 4** — ADG corporate groups or mydentist → lower priority

## Regenerating

```bash
python3 scripts/build-york-dental-marketing-list.py
```

On first run the script downloads the latest CQC directory CSV (~19MB) into this folder.

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
