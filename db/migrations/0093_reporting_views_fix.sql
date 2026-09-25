-- =============================================================================
-- 0093_reporting_views_fix
--
-- The reporting views were wrong in three ways:
--   * revenue was grouped by the UTC day, so an operator's early-morning sales
--     (IST 00:00–05:30) landed on the previous day;
--   * trips were joined to bookings before summing seats, so every trip's
--     capacity was counted once PER BOOKING — occupancy came out near 1 %;
--   * "route performance, last 30 days" also counted every future trip.
-- Rebuild them: seats and revenue are summed per trip first, days are the
-- operator's own calendar days, and the route window is the last 30 days up
-- to today, without cancelled trips.
-- =============================================================================

-- migrate:up
DROP MATERIALIZED VIEW IF EXISTS mv_route_performance;
DROP MATERIALIZED VIEW IF EXISTS mv_operator_revenue_daily;
DROP MATERIALIZED VIEW IF EXISTS mv_trip_daily;

CREATE MATERIALIZED VIEW mv_trip_daily AS
WITH per_trip AS (
  SELECT b.trip_id,
         sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')) AS sold,
         sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')) AS revenue,
         sum(b.seat_count) FILTER (WHERE b.status = 'cancelled') AS cancelled
    FROM bookings b GROUP BY b.trip_id
)
SELECT t.tenant_id, t.journey_date, t.route_id,
       count(*)                                   AS trips,
       sum(t.total_seats)                         AS total_seats,
       coalesce(sum(p.sold), 0)                   AS sold_seats,
       coalesce(sum(p.revenue), 0)                AS revenue_minor,
       coalesce(sum(p.cancelled), 0)              AS cancelled_seats
  FROM trips t LEFT JOIN per_trip p ON p.trip_id = t.id
 WHERE t.status <> 'cancelled'
 GROUP BY t.tenant_id, t.journey_date, t.route_id
WITH NO DATA;
CREATE UNIQUE INDEX mv_trip_daily_key ON mv_trip_daily (tenant_id, journey_date, route_id);

CREATE MATERIALIZED VIEW mv_operator_revenue_daily AS
SELECT b.tenant_id,
       (b.confirmed_at AT TIME ZONE coalesce(tn.timezone, 'Asia/Kolkata'))::date AS revenue_date,
       count(*) FILTER (WHERE b.status IN ('confirmed','completed'))                    AS bookings,
       coalesce(sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS gross_minor,
       coalesce(sum(b.total_minor) FILTER (WHERE b.status = 'cancelled'), 0)            AS cancelled_minor,
       coalesce(sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')), 0) AS seats_sold
  FROM bookings b JOIN tenants tn ON tn.id = b.tenant_id
 WHERE b.confirmed_at IS NOT NULL
 GROUP BY b.tenant_id, (b.confirmed_at AT TIME ZONE coalesce(tn.timezone, 'Asia/Kolkata'))::date
WITH NO DATA;
CREATE UNIQUE INDEX mv_operator_revenue_key ON mv_operator_revenue_daily (tenant_id, revenue_date);

CREATE MATERIALIZED VIEW mv_route_performance AS
WITH per_trip AS (
  SELECT b.trip_id,
         sum(b.seat_count) FILTER (WHERE b.status IN ('confirmed','completed')) AS sold,
         sum(b.total_minor) FILTER (WHERE b.status IN ('confirmed','completed')) AS revenue
    FROM bookings b GROUP BY b.trip_id
)
SELECT t.tenant_id, t.route_id,
       count(*)                          AS trips,
       coalesce(sum(t.total_seats), 0)   AS total_capacity,
       coalesce(sum(p.sold), 0)          AS seats_sold,
       CASE WHEN sum(t.total_seats) > 0
            THEN round(100.0 * coalesce(sum(p.sold), 0) / sum(t.total_seats), 2) ELSE 0 END AS occupancy_pct,
       coalesce(sum(p.revenue), 0)       AS revenue_minor
  FROM trips t
  JOIN tenants tn ON tn.id = t.tenant_id
  LEFT JOIN per_trip p ON p.trip_id = t.id
 WHERE t.status <> 'cancelled'
   AND t.journey_date BETWEEN (now() AT TIME ZONE coalesce(tn.timezone, 'Asia/Kolkata'))::date - 30
                          AND (now() AT TIME ZONE coalesce(tn.timezone, 'Asia/Kolkata'))::date
 GROUP BY t.tenant_id, t.route_id
WITH NO DATA;
CREATE UNIQUE INDEX mv_route_performance_key ON mv_route_performance (tenant_id, route_id);

REFRESH MATERIALIZED VIEW mv_trip_daily;
REFRESH MATERIALIZED VIEW mv_operator_revenue_daily;
REFRESH MATERIALIZED VIEW mv_route_performance;

-- migrate:down
-- The earlier definitions were wrong; migration 0010 recreates them if rolled back that far.
SELECT 1;
