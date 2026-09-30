# Bettermove listings sync

Pulls Bettermove's Rightmove branch (BRANCH^102082, for sale + sold STC) and
rebuilds the WiseCall Bettermove agent's knowledge base: one doc per property,
one per town, and a single-row price index (the budget lookup reads one row, so
it must not be chunked). Old docs for properties that left Rightmove are deleted.

bettermove.co.uk's own property feed stopped updating on 22 Sep 2026, which is
why this reads Rightmove.

- Runs daily at 07:30 UTC on the WiseCall Agent EC2 box from `/opt/bettermove-sync/`
  (`sync_rightmove.py`, `run.sh`, and a `state-rightmove.json` it keeps itself).
- Embeddings come from `kb-ingest` (OpenAI `text-embedding-3-small`).
- Failure -> email via the `ops-alert-email` edge function. `run.sh --test-alert` checks it.
- Refuses to sync if fewer than 90% of the listings Rightmove reports were pulled,
  so a block or a layout change can't wipe the KB.
- Dry run: `python3 sync_rightmove.py --dry-run`.
- Not covered: cron not firing at all. Check `/opt/bettermove-sync/sync.log` dates.
