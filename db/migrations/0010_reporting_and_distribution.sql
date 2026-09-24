-- =============================================================================
-- 0010_reporting_and_distribution
--
-- Reporting materialized views (occupancy, revenue, settlement) refreshed by
-- the worker, and the OTA/channel-partner distribution tables (partner registry
-- + a per-partner booking mapping). This closes the platform: operators sell,
-- OTAs distribute, and everyone reports.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- channel_partners — OTA / aggregator consumers of the distribution API. Each
-- authenticates with an api_key (Part 2) whose scopes gate what it can do.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE channel_partners (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          text NOT NULL,
  code          text NOT NULL,
  -- Commission the partner earns (separate from the platform's operator commission).
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  -- Where the partner wants booking/trip webhooks delivered.
  webhook_url   text,
  webhook_secret text,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE TRIGGER channel_partners_updated_at BEFORE UPDATE ON channel_partners FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('channel_partners');

-- ─────────────────────────────────────────────────────────────────────────────
-- Reporting materialized views.
--
-- These pre-aggregate the heavy analytical queries so the operator dashboard
-- and settlement reports read a small, indexed result instead of scanning
-- bookings/ledger live. They are REFRESHed CONCURRENTLY by the worker (every
-- few minutes / nightly), which never blocks reads. Each carries tenant_id so
-- the same RLS story holds on the views' base access.
--
-- NOTE: materialized views cannot have RLS policies directly; access is via the
-- reporting service which always filters by the ambient tenant_id, and the
-- underlying base tables remain RLS-protected.
-- ─────────────────────────────────────────────────────────────────────────────

-- Daily trip occupancy & revenue.
CREATE MATERIALIZED VIEW mv_trip_daily AS
SELECT
  t.tenant_id,
  t.journey_date,
  t.route_id,
  count(DISTINCT t.id)                                   AS trips,
  sum(t.total_seats)                                     AS total_seats,
  coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS sold_seats,
  coalesce(sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS revenue_minor,
  coalesce(sum(b.seat_count) FILTER (WHERE b.status = 'cancelled'), 0) AS cancelled_seats
FROM trips t
LEFT JOIN bookings b ON b.trip_id = t.id
GROUP BY t.tenant_id, t.journey_date, t.route_id
WITH NO DATA;
CREATE UNIQUE INDEX mv_trip_daily_key ON mv_trip_daily (tenant_id, journey_date, route_id);

-- Per-operator revenue & settlement summary by day.
CREATE MATERIALIZED VIEW mv_operator_revenue_daily AS
SELECT
  b.tenant_id,
  (b.confirmed_at AT TIME ZONE 'UTC')::date          AS revenue_date,
  count(*) FILTER (WHERE b.status IN ('confirmed','completed')) AS bookings,
  coalesce(sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS gross_minor,
  coalesce(sum(b.total_minor) FILTER (WHERE b.status = 'cancelled'), 0) AS cancelled_minor,
  coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS seats_sold
FROM bookings b
WHERE b.confirmed_at IS NOT NULL
GROUP BY b.tenant_id, (b.confirmed_at AT TIME ZONE 'UTC')::date
WITH NO DATA;
CREATE UNIQUE INDEX mv_operator_revenue_key ON mv_operator_revenue_daily (tenant_id, revenue_date);

-- Route performance: occupancy % and revenue over the last rolling window.
CREATE MATERIALIZED VIEW mv_route_performance AS
SELECT
  t.tenant_id,
  t.route_id,
  count(DISTINCT t.id) AS trips,
  coalesce(sum(t.total_seats), 0) AS total_capacity,
  coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS seats_sold,
  CASE WHEN sum(t.total_seats) > 0
       THEN round(100.0 * coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0) / sum(t.total_seats), 2)
       ELSE 0 END AS occupancy_pct,
  coalesce(sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS revenue_minor
FROM trips t
LEFT JOIN bookings b ON b.trip_id = t.id
WHERE t.journey_date >= (current_date - interval '30 days')
GROUP BY t.tenant_id, t.route_id
WITH NO DATA;
CREATE UNIQUE INDEX mv_route_performance_key ON mv_route_performance (tenant_id, route_id);

-- Helper the worker calls to refresh all reporting views concurrently.
CREATE OR REPLACE FUNCTION refresh_reporting_views()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  -- CONCURRENTLY requires the unique indexes above and never blocks readers.
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trip_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_operator_revenue_daily;
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_route_performance;
EXCEPTION WHEN feature_not_supported OR object_not_in_prerequisite_state THEN
  -- First refresh cannot be CONCURRENT (view has no data yet); do a plain one.
  REFRESH MATERIALIZED VIEW mv_trip_daily;
  REFRESH MATERIALIZED VIEW mv_operator_revenue_daily;
  REFRESH MATERIALIZED VIEW mv_route_performance;
END; $$;

-- migrate:down

DROP FUNCTION IF EXISTS refresh_reporting_views();
DROP MATERIALIZED VIEW IF EXISTS mv_route_performance;
DROP MATERIALIZED VIEW IF EXISTS mv_operator_revenue_daily;
DROP MATERIALIZED VIEW IF EXISTS mv_trip_daily;
DROP TABLE IF EXISTS channel_partners;
