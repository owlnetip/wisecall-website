# Property outreach CRM — Birmingham pilot

Same Mailchimp-style workflow as dental (`/admin/outreach`), without Attio or Instantly.

## Setup

1. Run migration `0028_outreach_property_birmingham.sql` on the portal Supabase project (adds `vertical`, property segments, lettings templates).
2. Regenerate seed (already committed for Birmingham):

```bash
python3 scripts/sync-estate-prospects-seed.py --region birmingham
```

3. In `/admin/outreach` → **Property** → **Import Birmingham estates**.

## Segments

| Segment | Meaning |
|---------|---------|
| `property_ready` | Has email (and/or known CRM) — can send Resend sequence |
| `property_unknown` | Active independent, missing email/CRM — add email to auto-promote |
| `property_corporate_hold` | Corporate groups — email disabled |

## Daily workflow

1. Smart list **Missing email** → paste website/director emails as you find them (promotes to ready).
2. **Ready to email** → send property lettings initial (schedules day 3/7/14).
3. **Opened · no reply** → call or personal chase.
4. **Mark replied** when they answer (cancels remaining follow-ups).

## Data note

The raw Birmingham marketing CSV mixes other `B*` UK postcodes (Bath, Brighton, etc.). The sync script filters with `^B[0-9]` from `regions/birmingham.json`, so the seed is 29 true Birmingham actives.

## Enrichment (directors / websites / emails)

```bash
python3 scripts/enrich-birmingham-estate-prospects.py
python3 scripts/sync-estate-prospects-seed.py --region birmingham
```

Outputs:
- `data/research/estate-agents/birmingham-estate-enrichment.csv`
- updates `birmingham-b-estate-marketing-list.csv`
- regenerates `apps/portal/src/data/estate-prospects-seed.json`

Current Birmingham seed after cleanup:
- **11 `property_ready`** with inbox emails (incl. Alderwood on Street)
- **18 `property_unknown`** still need a website/email
- All 29 have a Companies House director name as `contact_name`

False-positive directory sites are blocklisted; re-check any new domains that don’t mention Birmingham / local postcodes before blasting.
