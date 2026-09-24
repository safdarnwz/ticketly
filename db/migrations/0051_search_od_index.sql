-- =============================================================================
-- 0051_search_od_index
--
-- The public (www) search first asks "WHICH operators have a published route
-- for this origin→destination?" across ALL tenants, then fans out only to
-- those. routes_od_idx leads with tenant_id, so it cannot serve that
-- cross-tenant question; this partial covering index answers it with an
-- index-only scan, however many operators are on the platform.
-- =============================================================================

-- migrate:up
CREATE INDEX IF NOT EXISTS routes_published_od_idx
  ON routes (origin_city_id, dest_city_id) INCLUDE (tenant_id)
  WHERE status = 'published' AND deleted_at IS NULL;

-- migrate:down
DROP INDEX IF EXISTS routes_published_od_idx;
