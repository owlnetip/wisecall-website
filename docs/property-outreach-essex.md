# Property outreach CRM — Essex (Rightmove source)

Essex estate agents are sourced from the [Rightmove Essex directory](https://www.rightmove.co.uk/estate-agents/Essex.html) (~925 branch listings → ~720 unique branches), then enriched with Companies House directors, agency websites, emails, and CRM fingerprints.

## Build the list (Rightmove)

```bash
python3 scripts/build-essex-estate-agents-rightmove.py
```

Outputs:
- `data/research/estate-agents/essex-rightmove-branches-raw.csv` — deduped branch scrape
- `data/research/estate-agents/essex-estate-marketing-list.csv` — CRM-ready marketing list

Each row includes branch phone, postcode, Rightmove profile URL, and any email/website found in branch descriptions.

## Enrichment (directors / websites / emails / CRM)

```bash
PYTHONUNBUFFERED=1 python3 scripts/enrich-estate-prospects.py --region essex
```

Optional: `--limit 50` for a pilot batch.

Then sync to portal seed:

```bash
python3 scripts/sync-estate-prospects-seed.py --region essex
```

## Director work emails (optional, paid)

After enrichment populates `director_names`:

```bash
python3 scripts/prepare_estate_directors.py essex
FULLENRICH_API_KEY=... python3 scripts/fullearch-estate-director-candidates.py
```

## Segments

Same as Birmingham — see `docs/property-outreach-birmingham.md`:
- `property_ready` — has email and/or known CRM
- `property_unknown` — needs email/CRM
- `property_corporate_hold` — corporate groups (Abbotts, Connells, etc.)

## Notes

- Rightmove lists sales + lettings separately; we dedupe by `branch_id`.
- Companies House lookup uses the public register (no API key required).
- Re-check any generic inbox before cold email; prefer director names from CH when present.
