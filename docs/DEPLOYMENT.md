# Deployment (No Docker)

The platform runs directly on Node.js 22 + PostgreSQL 16 with systemd (or PM2)
— no containers, per the project constraint.

## Topology

```
            ┌── nginx (TLS, LB, health-aware) ──┐
 Internet ──┤   deploy/nginx/ticketly.conf     │
            └───────────────┬───────────────────┘
        ┌──────────┬────────┼────────┬──────────┐
     api@1      api@2     api@3     api@4     (systemd templated units, ports 3001-4)
        └──────────┴────────┼────────┴──────────┘
                            │  PgBouncer (transaction pooling, :6432)
                   ┌────────┴─────────┐
             Postgres primary   read replica(s)
                            │
                   worker@1, worker@2   (outbox dispatch, schedulers)
                            │
                          Redis (L2 cache, locks, rate limit)
```

## First deploy

```bash
# 1. Build (compiles apps + libs together — one artifact).
npm ci
npm run build

# 2. Provision the DB role (CRITICAL: non-superuser, or RLS is bypassed).
psql -U postgres -f db/roles.sql        # creates gds_app (NOSUPERUSER NOBYPASSRLS)

# 3. Apply Postgres tuning + run migrations (as owner/superuser).
cat deploy/postgres/postgresql.tuning.conf >> $PGDATA/postgresql.conf   # then restart
npm run db:migrate

# 4. Configure. .env points DB_USER at gds_app (NOT postgres).
cp .env.example /opt/ticketly/.env && edit it

# 5. Install services.
cp deploy/systemd/*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now ticketly-api@1 ticketly-api@2 ticketly-api@3 ticketly-api@4
systemctl enable --now ticketly-worker@1 ticketly-worker@2
cp deploy/nginx/ticketly.conf /etc/nginx/conf.d/ && nginx -s reload
```

PM2 is a drop-in alternative: `pm2 start deploy/ecosystem.config.cjs --env production`.

## Rolling / zero-downtime deploy

Migrations follow expand → migrate → contract (never rename in place; add columns
nullable-or-defaulted first; build indexes CONCURRENTLY). Then restart instances
one at a time:

```bash
npm run db:migrate                          # backward-compatible migration first
for i in 1 2 3 4; do
  systemctl restart ticketly-api@$i     # SIGTERM → drain readiness → wait for LB
  sleep 10                               # nginx health-check removes it while draining
done
```

The graceful-shutdown sequence (bootstrap.ts) flips `/health/ready` to draining,
waits `SHUTDOWN_DELAY_MS` for nginx to notice, finishes in-flight requests, then
closes pools — so no request is dropped and no 502 is served.

## Why no Docker is fine here

systemd gives process supervision, restart, resource limits, log capture
(journald) and templated scaling — everything a container orchestrator provides
for a single-service app — without the image build/registry overhead. The one
artifact is `dist/`; config is an EnvironmentFile; secrets never enter an image.
