#!/bin/bash
# Daily Bettermove listings sync (Rightmove -> WiseCall KB), run from cron on the
# WiseCall Agent EC2 box:  30 7 * * * /opt/bettermove-sync/run.sh
# Emails owlnetip@gmail.com (via the ops-alert-email edge fn) if the sync fails.
#   run.sh --test-alert   sends a test alert and exits, to check the path works
#
# Only the two Supabase values are taken from the voice runtime env (sourcing the
# whole file prints warnings).
ENV_FILE=/opt/wisecall-edge/.env
DIR="$(cd "$(dirname "$0")" && pwd)"
export SUPABASE_URL=$(grep -m1 "^SUPABASE_URL=" "$ENV_FILE" | cut -d= -f2-)
export SUPABASE_SERVICE_ROLE_KEY=$(grep -m1 "^SUPABASE_SERVICE_ROLE_KEY=" "$ENV_FILE" | cut -d= -f2-)
cd "$DIR" || exit 1

alert() {  # $1 subject, $2 body
  python3 - "$1" "$2" <<'PY'
import json, os, sys, urllib.request
req = urllib.request.Request(
    os.environ["SUPABASE_URL"].rstrip("/") + "/functions/v1/ops-alert-email",
    data=json.dumps({"subject": sys.argv[1], "body": sys.argv[2]}).encode(),
    headers={"Authorization": "Bearer " + os.environ["SUPABASE_SERVICE_ROLE_KEY"],
             "Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=30)
except Exception as e:
    print("alert email failed:", e)
PY
}

if [ "$1" = "--test-alert" ]; then
  alert "TEST: Bettermove sync alert" "Test from $(hostname) at $(date -u +%FT%TZ). If you got this, failure alerts work."
  exit 0
fi

# -E 99: another run is still going, so skip quietly rather than alert.
flock -n -E 99 /tmp/bettermove-sync.lock python3 sync_rightmove.py >> sync.log 2>&1
code=$?
if [ $code -ne 0 ] && [ $code -ne 99 ]; then
  alert "Bettermove listings sync FAILED (exit $code)" \
    "The daily Rightmove sync failed, so Bettermove's chat listings are going stale.

Last log lines on the WiseCall Agent box (/opt/bettermove-sync/sync.log):

$(tail -n 25 sync.log)"
fi
exit $code
