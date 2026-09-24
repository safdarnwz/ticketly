# Performance Playbook

The SLOs, why they hold, and how to keep them.

## SLOs (enforced by the k6 thresholds in `load-tests/`)

| Path | Target |
|---|---|
| Trip search | p99 < 120 ms, p95 < 80 ms |
| Price quote | p99 < 150 ms |
| Booking confirm | p99 < 400 ms |
| Availability read | < 1 ms (cache hit) |
| GPS ingest | > 500 writes/s per node |

## Why they hold (the mechanisms, by layer)

- **Fastify** — schema-compiled JSON serialisation, flat p99.
- **Two-tier cache + single-flight** — master data & search served from L1
  (~0.0001 ms) / L2 (~0.5 ms); a cache-expiry stampede collapses to one loader.
- **Leg-bitmap availability** — "seats free on A→C" is ONE indexed aggregate
  with a bitwise AND, not a per-seat loop; search prices dozens of trips in ms.
- **UUID v7 keys** — time-ordered inserts keep B-tree writes on the right edge;
  ~90% buffer hit vs ~15% for v4 on large tables.
- **Read replicas** — search/reports offload the primary; lag-aware failover.
- **Keyset pagination** — O(log n) forever, no OFFSET scans.
- **Partitioned high-write tables** — gps_pings (daily), outbox/audit (monthly);
  drops instead of DELETEs, so autovacuum never falls behind.
- **Load shedding** — under event-loop pressure, shed a slice as 503 so the rest
  stay fast.

## When a target regresses — the checklist

1. `/metrics` → `gds_http_request_duration_seconds` by route: which route?
2. `gds_db_query_duration_seconds` by operation: is it the DB or the app?
3. `pg_stat_statements` → the slow statement → `EXPLAIN (ANALYZE, BUFFERS)`.
4. `gds_db_pool_waiting_requests > 0` sustained → pool too small OR a slow query
   holding connections; check `gds_db_pool_connections_idle`.
5. `gds_cache_operations_total{result="miss"}` spiking → a TTL too short or an
   invalidation storm.
6. Replica lag (`gds` replica health logs) → reads falling back to primary.

## Capacity math

- Pool: `DB_POOL_MAX × api_instances ≤ max_connections − reserved`. With
  PgBouncer (transaction mode) in front, the app pools multiplex onto few real
  backends — size PgBouncer's `default_pool_size`, not per-instance pools, to the
  DB core count.
- A pool larger than ~2-4× cores makes Postgres SLOWER (context-switching), not
  faster.
