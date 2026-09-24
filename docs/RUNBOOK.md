# Runbook

Operational responses to the incidents this system can have.

## "Bookings are failing with 503"
Load shedding is active (event loop behind) or the DB pool is exhausted.
- `/metrics`: `gds_http_in_flight_requests` high + `gds_db_pool_waiting_requests > 0`.
- Check for a slow query holding connections (`pg_stat_activity`, `state='active'`).
- Short term: add an API instance (`systemctl start ticketly-api@5`).
- Root cause: the slow statement via `pg_stat_statements`; add an index / fix the plan.

## "A seat was double-sold" (should be impossible)
The anti-double-sell gate is a row lock + bitmap check inside the booking
transaction (verified under concurrency). If this ever occurs:
- Confirm the app connects as `gds_app` (NOSUPERUSER) — a superuser connection
  bypasses RLS but NOT the seat lock, so this wouldn't cause it; still verify.
- Check for a manual `UPDATE trip_seats` outside the service (audit_log).
- The `occupied_legs` bitmap is the truth; reconcile from `booking_seats`.

## "Outbox is backing up" (events not delivered)
- `/metrics`: `gds_outbox_pending_events{status="pending"}` climbing.
- Is the worker running? `systemctl status ticketly-worker@1`.
- Poison event? Check `outbox_events WHERE status='dead'` and `last_error`.
- Requeue after a fix: `UPDATE outbox_events SET status='pending' WHERE status='dead' AND …`.

## "The ledger doesn't balance"
- `GET /reports/../trial-balance` → `balanced: false` means an entry is broken.
  This should be impossible (app + deferred trigger both enforce Σ=0).
- Find it: `SELECT entry_id, sum(amount_minor) FROM ledger_postings GROUP BY entry_id HAVING sum(amount_minor) <> 0`.
- Never hand-edit postings; post a correcting balanced entry.

## "Refund disputes"
Refunds are reproducible: re-run `computeRefund(paid, departure, cancelledAt,
policy)` — the `cancellations` row records exactly what was applied.

## Rolling deploy caused 502s
`SHUTDOWN_DELAY_MS` is too short relative to nginx's health-check interval, or
nginx `keepalive_timeout` ≥ the app's `keepAliveTimeout`. Fix both per
`docs/DEPLOYMENT.md`.

## Scaling levers (in order of reach)
1. More API instances (`ticketly-api@N`).
2. Enable/scale Redis L2 cache (`CACHE_L2_ENABLED=true`).
3. Add read replicas (`DB_REPLICA_HOSTS`).
4. PgBouncer in front of Postgres.
5. Split GPS ingest into its own worker fleet (same modules, different entry).
