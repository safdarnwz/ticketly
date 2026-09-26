-- =============================================================================
-- 0095_staff_targets_warnings
--
-- A daily counter-sales target per staff member (356) — the performance report
-- shows how far each person got — and written warnings an admin issues to a
-- staff member (388), which the staff member sees and acknowledges.
-- =============================================================================

-- migrate:up
CREATE TABLE staff_targets (
  tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id              uuid NOT NULL REFERENCES users(id),
  daily_bookings       integer NOT NULL CHECK (daily_bookings BETWEEN 1 AND 1000),
  daily_revenue_minor  bigint CHECK (daily_revenue_minor IS NULL OR daily_revenue_minor BETWEEN 100 AND 1000000000),
  set_by               uuid REFERENCES users(id),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id)
);
SELECT apply_tenant_rls('staff_targets');

CREATE TABLE staff_warnings (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id),
  reason           text NOT NULL CHECK (reason IN ('low_sales', 'high_cancellations', 'conduct', 'attendance', 'other')),
  note             text NOT NULL CHECK (length(note) BETWEEN 10 AND 1000),
  issued_by        uuid NOT NULL REFERENCES users(id),
  issued_at        timestamptz NOT NULL DEFAULT now(),
  acknowledged_at  timestamptz
);
CREATE INDEX staff_warnings_user_idx ON staff_warnings (tenant_id, user_id, issued_at DESC);
SELECT apply_tenant_rls('staff_warnings');

-- migrate:down
DROP TABLE IF EXISTS staff_warnings;
DROP TABLE IF EXISTS staff_targets;
