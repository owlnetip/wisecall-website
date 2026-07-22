#!/usr/bin/env bash
# Wait for Essex enrichment to finish, then sync seed and write a done marker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$ROOT/data/research/estate-agents/essex-enrichment-run.log"
DONE="$ROOT/data/research/estate-agents/.essex-enrichment-complete"
OUT="$ROOT/data/research/estate-agents/essex-estate-enrichment.csv"

echo "Watching for enrichment completion..." | tee -a "$LOG"

while true; do
  if grep -q 'Wrote.*essex-estate-enrichment.csv' "$LOG" 2>/dev/null; then
    break
  fi
  if ! pgrep -f 'enrich-estate-prospects.py --region essex' >/dev/null 2>&1; then
    if [[ -f "$OUT" ]] && [[ $(wc -l < "$OUT") -ge 700 ]]; then
      break
    fi
    if grep -q 'Websites:' "$LOG" 2>/dev/null; then
      break
    fi
  fi
  sleep 30
done

python3 "$ROOT/scripts/sync-estate-prospects-seed.py" --region essex --region birmingham

ROWS=$(($(wc -l < "$OUT") - 1))
WITH_EMAIL=$(python3 - <<PY
import csv
from pathlib import Path
p = Path("$OUT")
rows = list(csv.DictReader(p.open()))
print(sum(1 for r in rows if (r.get("email") or "").strip()))
PY
)
WITH_DIR=$(python3 - <<PY
import csv
from pathlib import Path
p = Path("$OUT")
rows = list(csv.DictReader(p.open()))
print(sum(1 for r in rows if (r.get("contact_name") or "").strip()))
PY
)

{
  echo "completed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "total_rows=$ROWS"
  echo "with_email=$WITH_EMAIL"
  echo "with_directors=$WITH_DIR"
  echo "log=$LOG"
  echo "enrichment_csv=$OUT"
  echo "marketing_csv=$ROOT/data/research/estate-agents/essex-estate-marketing-list.csv"
} > "$DONE"

echo "=== ESSEX ENRICHMENT COMPLETE ===" | tee -a "$LOG"
echo "Rows: $ROWS | Emails: $WITH_EMAIL | Directors: $WITH_DIR" | tee -a "$LOG"
echo "Done marker: $DONE" | tee -a "$LOG"

# Commit updated enrichment outputs if on the feature branch
if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  cd "$ROOT"
  git add \
    data/research/estate-agents/essex-estate-enrichment.csv \
    data/research/estate-agents/essex-estate-enrichment.json \
    data/research/estate-agents/essex-estate-marketing-list.csv \
    apps/portal/src/data/estate-prospects-seed.json \
    "$DONE" 2>/dev/null || true
  if ! git diff --cached --quiet; then
    git commit -m "Complete Essex estate enrichment ($ROWS agents, $WITH_EMAIL emails)" || true
    git push origin HEAD 2>/dev/null || true
  fi
fi
