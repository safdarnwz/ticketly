#!/bin/bash
# run-history.sh FROM TO  — replay trading day by day (dates YYYY-MM-DD, inclusive):
# the morning (00:30 IST) crews the day's trips and sells; the night (23:50 IST)
# runs them. Postgres, the API and the worker run on that clock (timeshift.sh).
set -u
cd "$(dirname "$0")/../.."
API_DIR=${API_DIR:-$(pwd)}
LOGS=${LOGS:-/tmp/scale-logs}
mkdir -p "$LOGS"
set +e; set -a; . ./.env 2>/dev/null; set +a
d="$1"
while [[ "$d" < "$2" || "$d" == "$2" ]]; do
  prev=$(date -u -d "$d -1 day" +%F)
  API_DIR=$API_DIR bash scripts/scale/timeshift.sh "$prev 19:00:00" > /dev/null
  npx tsx scripts/scale/history.ts sales "$d" > "$LOGS/sales-$d.log" 2>&1
  API_DIR=$API_DIR bash scripts/scale/timeshift.sh "$d 18:20:00" > /dev/null
  npx tsx scripts/scale/history.ts ops "$d" > "$LOGS/ops-$d.log" 2>&1
  echo "$(date +%T) $d done: $(grep -h 'sales done' "$LOGS/sales-$d.log") | $(grep -h ' ops:' "$LOGS/ops-$d.log")"
  d=$(date -u -d "$d +1 day" +%F)
done
