-- =============================================================================
-- 0080_trip_suggestion_decisions
--
-- The operator's answer to a "cancel this low-demand trip?" suggestion (#280):
-- accepted or rejected, why, and by whom. A rejected suggestion is not shown
-- again for that trip.
-- =============================================================================

-- migrate:up
CREATE TABLE trip_suggestion_decisions (
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('cancel')),
  decision    text NOT NULL CHECK (decision IN ('accepted', 'rejected')),
  reason      text NOT NULL DEFAULT '',
  forecast_pct numeric(5,1),
  decided_by  uuid REFERENCES users(id),
  decided_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, kind)
);
SELECT apply_tenant_rls('trip_suggestion_decisions');

-- migrate:down
DROP TABLE IF EXISTS trip_suggestion_decisions;
