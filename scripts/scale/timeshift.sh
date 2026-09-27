#!/bin/bash
# timeshift.sh "<YYYY-MM-DD HH:MM:SS>" | real
#
# Restarts Postgres, the API and the worker with libfaketime at that moment
# (the clock then runs on from there), so the scale scripts can replay a month
# day by day through the real services. "real" goes back to the wall clock.
# API_DIR (default: this checkout) is where `npm run dev` / `dev:worker` run.
set -e
FT=${FT:-/usr/lib/x86_64-linux-gnu/faketime/libfaketime.so.1}
API_DIR=${API_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}
PGBIN=/usr/lib/postgresql/16/bin
PGDATA=/var/lib/postgresql/16/main
PGCONF=/etc/postgresql/16/main/postgresql.conf

for f in api worker; do
  [ -f "$API_DIR/$f.pid" ] && { pkill -P "$(cat "$API_DIR/$f.pid")" 2>/dev/null || true; kill "$(cat "$API_DIR/$f.pid")" 2>/dev/null || true; }
done
pkill -f "apps/(api|worker)/src/main.ts" 2>/dev/null || true
# A graceful shutdown drains requests first: wait for both to be gone before starting again.
for i in $(seq 1 60); do pgrep -f "apps/(api|worker)/src/main.ts" >/dev/null || break; sleep 0.5; done
pkill -9 -f "apps/(api|worker)/src/main.ts" 2>/dev/null || true
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -m fast stop" >/dev/null 2>&1 || true

if [ "$1" = "real" ]; then
  su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-c config_file=$PGCONF' -l /tmp/pg.log start" >/dev/null
  PRE=""
else
  su postgres -c "LD_PRELOAD=$FT FAKETIME='@$1' FAKETIME_DONT_FAKE_MONOTONIC=1 $PGBIN/pg_ctl -D $PGDATA -o '-c config_file=$PGCONF' -l /tmp/pg.log start" >/dev/null
  PRE="LD_PRELOAD=$FT FAKETIME='@$1' FAKETIME_DONT_FAKE_MONOTONIC=1"
fi
for i in $(seq 1 30); do su postgres -c "psql -tAc 'select 1'" >/dev/null 2>&1 && break; sleep 1; done

cd "$API_DIR"
set +e; set -a; . ./.env 2>/dev/null; set +a; set -e
export RATE_LIMIT_ENABLED=false LOG_LEVEL=${LOG_LEVEL:-warn}
eval "$PRE nohup node --enable-source-maps -r @swc-node/register -r tsconfig-paths/register apps/api/src/main.ts > api.out 2>&1 &"
echo $! > api.pid
eval "$PRE nohup node --enable-source-maps -r @swc-node/register -r tsconfig-paths/register apps/worker/src/main.ts > worker.out 2>&1 &"
echo $! > worker.pid
for i in $(seq 1 90); do curl -sf "http://localhost:${HTTP_PORT:-3000}/health" >/dev/null && break; sleep 1; done
curl -sf "http://localhost:${HTTP_PORT:-3000}/health" >/dev/null || { echo "API did not start"; tail -20 api.out; exit 1; }
echo "clock: $(su postgres -c "psql -tAc 'select now()'")"
