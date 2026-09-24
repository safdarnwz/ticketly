-- =============================================================================
-- 0032_remove_counter_cash
--
-- The cash-counter / shift-reconciliation feature has been removed from the
-- product entirely. Staff-assisted sales now go through the same verified
-- payment-gateway charge a self-service customer uses (see
-- PaymentService.chargeTest / StaffTripPage) — there is no more "assume cash
-- was collected" shortcut anywhere in the system. This migration drops the
-- now-unused counter_shifts table; nothing else referenced it.
-- =============================================================================

-- migrate:up

DROP TABLE IF EXISTS counter_shifts;

-- migrate:down

CREATE TABLE counter_shifts (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id       uuid REFERENCES branches(id),
  opened_by       uuid NOT NULL REFERENCES users(id),
  opening_cash_minor bigint NOT NULL DEFAULT 0,
  closed_by       uuid REFERENCES users(id),
  closing_cash_minor bigint,
  expected_cash_minor bigint,
  status          text NOT NULL DEFAULT 'open',
  opened_at       timestamptz NOT NULL DEFAULT now(),
  closed_at       timestamptz,
  notes           text
);
CREATE INDEX counter_shifts_tenant_status_idx ON counter_shifts (tenant_id, status);
SELECT apply_tenant_rls('counter_shifts');
