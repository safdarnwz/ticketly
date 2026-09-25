#!/usr/bin/env bash
# =============================================================================
#  Server-side release script — installs one release artifact, migrates,
#  switches traffic with a rolling restart, and rolls back on failure.
#
#  Called by the CD pipeline over SSH (and usable by hand):
#    release.sh deploy   <artifact.tgz> <version>
#    release.sh rollback                      # back to the previous release
#    release.sh current                       # print the live version
#
#  Layout (TICKETLY_HOME, default /opt/ticketly):
#    releases/<version>/   one directory per release (kept: KEEP_RELEASES)
#    current -> releases/<version>              what systemd runs
#    shared/.env                                config + secrets, never in a release
#    deploy.env                                 this script's settings (below)
#
#  deploy.env (sourced if present):
#    API_UNITS="ticketly-api@1 ticketly-api@2"  restarted one at a time
#    WORKER_UNITS="ticketly-worker@1"           restarted after the API
#    API_HEALTH_URLS="http://127.0.0.1:3001/health/ready http://127.0.0.1:3002/health/ready"
#                                               checked after each API restart (same order)
#    KEEP_RELEASES=5
#
#  Migrations run BEFORE traffic moves, so they must stay backward compatible
#  (expand → migrate → contract, see docs/DEPLOYMENT.md). A rollback therefore
#  never reverts the database: the previous release keeps working on it.
# =============================================================================
set -euo pipefail

TICKETLY_HOME=${TICKETLY_HOME:-/opt/ticketly}
[ -f "$TICKETLY_HOME/deploy.env" ] && . "$TICKETLY_HOME/deploy.env"
API_UNITS=${API_UNITS:-}
WORKER_UNITS=${WORKER_UNITS:-}
API_HEALTH_URLS=${API_HEALTH_URLS:-}
KEEP_RELEASES=${KEEP_RELEASES:-5}
RELEASES="$TICKETLY_HOME/releases"
CURRENT="$TICKETLY_HOME/current"

log() { printf '[release] %s\n' "$*"; }
die() { printf '[release] ERROR: %s\n' "$*" >&2; exit 1; }

wait_healthy() { # url
  local url=$1
  for _ in $(seq 1 30); do
    curl -fsS --max-time 3 "$url" >/dev/null 2>&1 && return 0
    sleep 2
  done
  return 1
}

restart_all() { # restart every unit, API one at a time behind its health check
  local i=0 urls unit url
  read -r -a urls <<<"$API_HEALTH_URLS"
  for unit in $API_UNITS; do
    log "restarting $unit"
    sudo systemctl restart "$unit"
    url=${urls[$i]:-}
    if [ -n "$url" ] && ! wait_healthy "$url"; then
      log "$unit did not become healthy at $url"
      return 1
    fi
    i=$((i + 1))
  done
  for unit in $WORKER_UNITS; do
    log "restarting $unit"
    sudo systemctl restart "$unit"
  done
}

switch_to() { # release dir
  ln -sfn "$1" "$CURRENT.tmp"
  mv -Tf "$CURRENT.tmp" "$CURRENT"
}

previous_release() { # the newest release that is not the live one
  local live
  live=$(readlink -f "$CURRENT" 2>/dev/null || true)
  ls -1dt "$RELEASES"/*/ 2>/dev/null | sed 's:/$::' | while read -r d; do
    [ "$(readlink -f "$d")" != "$live" ] && { echo "$d"; break; }
  done
}

cmd_deploy() {
  local artifact=$1 version=$2 dir previous
  dir="$RELEASES/$version"
  [ -f "$artifact" ] || die "artifact $artifact not found"
  [[ "$version" =~ ^[A-Za-z0-9._-]+$ ]] || die "bad version '$version'"
  mkdir -p "$RELEASES" "$TICKETLY_HOME/shared"
  [ -f "$TICKETLY_HOME/shared/.env" ] || die "$TICKETLY_HOME/shared/.env is missing"
  previous=$(readlink -f "$CURRENT" 2>/dev/null || true)

  log "installing $version"
  rm -rf "$dir" && mkdir -p "$dir"
  tar -xzf "$artifact" -C "$dir"
  ln -sfn "$TICKETLY_HOME/shared/.env" "$dir/.env"
  (cd "$dir" && npm ci --omit=dev --no-audit --no-fund --loglevel=error)

  log "migrating the database"
  (cd "$dir" && set -a && . ./.env && set +a && node dist/scripts/migrate.js up)

  log "switching traffic to $version"
  switch_to "$dir"
  if ! restart_all; then
    if [ -n "$previous" ] && [ -d "$previous" ]; then
      log "rolling back to $(basename "$previous")"
      switch_to "$previous"
      restart_all || true
    fi
    die "release $version failed its health checks — rolled back"
  fi

  # Keep the newest KEEP_RELEASES (the live one always among them).
  ls -1dt "$RELEASES"/*/ | sed 's:/$::' | tail -n +"$((KEEP_RELEASES + 1))" | while read -r old; do
    [ "$(readlink -f "$old")" = "$(readlink -f "$CURRENT")" ] || rm -rf "$old"
  done
  log "live: $version"
}

cmd_rollback() {
  local prev
  prev=$(previous_release)
  [ -n "$prev" ] || die "no previous release to roll back to"
  log "rolling back to $(basename "$prev")"
  switch_to "$prev"
  restart_all || die "the previous release is unhealthy too — intervene by hand"
  log "live: $(basename "$prev")"
}

case "${1:-}" in
  deploy) shift; [ $# -eq 2 ] || die "usage: release.sh deploy <artifact.tgz> <version>"; cmd_deploy "$@" ;;
  rollback) cmd_rollback ;;
  current) [ -L "$CURRENT" ] || die "nothing deployed yet"; basename "$(readlink -f "$CURRENT")" ;;
  *) die "usage: release.sh deploy <artifact.tgz> <version> | rollback | current" ;;
esac
