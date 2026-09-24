-- =============================================================================
-- 0033_gps_pings_rls
--
-- gps_pings (migration 0009) has tenant_id NOT NULL — a genuinely
-- tenant-scoped table (each operator's own fleet GPS trail) — but never had
-- apply_tenant_rls() called on it, unlike every comparable table in this
-- schema. The write path (TrackingService.ingestPing) is authenticated and
-- correctly scopes by tenant_id explicitly, and the one public read path
-- (liveState) deliberately reads a separate, narrow-fields view (trip_live)
-- under an explicit bypassRls rather than this table directly — so this
-- gap was not actively exploited, but it's still a real defense-in-depth
-- hole: any future query against gps_pings that forgets an explicit
-- tenant_id filter would silently return every operator's fleet locations.
-- =============================================================================

-- migrate:up

SELECT apply_tenant_rls('gps_pings');

-- migrate:down

ALTER TABLE gps_pings DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON gps_pings;
