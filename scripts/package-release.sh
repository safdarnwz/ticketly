#!/usr/bin/env bash
# Package the built app (npm run build first) into one release artifact:
#   release/ticketly-<version>.tgz  + .sha256
# Contents: dist/ (with the migrations at dist/db, where the compiled runner
# looks), package.json, package-lock.json, .nvmrc, deploy/, RELEASE.
# The same artifact is deployed to stage, uat and prod — never rebuilt.
set -euo pipefail

VERSION=${1:?usage: package-release.sh <version> <commit>}
COMMIT=${2:?usage: package-release.sh <version> <commit>}
[ -f dist/scripts/migrate.js ] || { echo "dist/ is missing — run npm run build first" >&2; exit 1; }

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
cp -r dist "$STAGE/dist"
rm -rf "$STAGE/dist/db" && cp -r db "$STAGE/dist/db"
find "$STAGE/dist" -name '*.map' -delete
cp package.json package-lock.json .nvmrc "$STAGE/"
cp -r deploy "$STAGE/deploy"
printf 'version=%s\ncommit=%s\nbuilt_at=%s\n' "$VERSION" "$COMMIT" "$(date -u +%FT%TZ)" > "$STAGE/RELEASE"

# The compiled migration runner must find every migration in the package.
expected=$(ls db/migrations/*.sql | wc -l)
packaged=$(ls "$STAGE"/dist/db/migrations/*.sql | wc -l)
[ "$expected" -eq "$packaged" ] || { echo "migrations: expected $expected, packaged $packaged" >&2; exit 1; }

mkdir -p release
OUT="release/ticketly-$VERSION.tgz"
tar -czf "$OUT" -C "$STAGE" .
(cd release && sha256sum "ticketly-$VERSION.tgz" > "ticketly-$VERSION.tgz.sha256")
echo "packaged $OUT ($(du -h "$OUT" | cut -f1), $packaged migrations)"
