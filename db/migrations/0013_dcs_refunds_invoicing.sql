-- =============================================================================
-- 0013_dcs_refunds_invoicing
--
-- Departure control (trip chart + closeout), the refund lifecycle (state
-- machine + gateway reconciliation), and GST tax invoices with a compliant
-- sequential numbering series and credit notes on cancellation.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- trip_charts — one per trip at departure. Records the reconciled seat/cash
-- position so a trip can be closed out with a clear picture.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE trip_charts (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id           uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  total_seats       smallint NOT NULL,
  confirmed_seats   smallint NOT NULL,
  boarded_seats     smallint NOT NULL,
  no_show_seats     smallint NOT NULL,
  vacant_seats      smallint NOT NULL,
  spot_sales_count  smallint NOT NULL DEFAULT 0,
  cash_declared_minor bigint NOT NULL DEFAULT 0,
  cash_expected_minor bigint NOT NULL DEFAULT 0,
  cash_variance_minor bigint NOT NULL DEFAULT 0,
  reconciled        boolean NOT NULL DEFAULT false,
  charted_by        uuid REFERENCES users(id),
  charted_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- refunds already exist (Part 8). Extend for the lifecycle: destination, state,
-- gateway reconciliation fields, and the linked cancellation.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'source'; -- 'source'|'wallet'
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS reconciled_at timestamptz;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS cancellation_id uuid REFERENCES cancellations(id);
-- The status column already exists as text; add an index on the working set.
CREATE INDEX IF NOT EXISTS refunds_working_idx ON refunds (status) WHERE status IN ('processing','failed');

-- ─────────────────────────────────────────────────────────────────────────────
-- invoice_series — the atomic per-(tenant, prefix, financial-year) counter that
-- guarantees a gapless, unique invoice sequence (a GST requirement). Allocation
-- is an UPSERT … RETURNING that increments and returns in one statement.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE invoice_series (
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  series_key    text NOT NULL,             -- 'INV:2026-27'
  last_sequence integer NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, series_key)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- invoices — GST tax invoices and credit notes. A credit note (kind='credit')
-- references the original invoice and is raised on cancellation/refund.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE invoices (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid REFERENCES bookings(id),
  kind              text NOT NULL DEFAULT 'tax',   -- 'tax'|'credit'
  invoice_number    text NOT NULL,
  -- Supplier + recipient GSTINs and place-of-supply for the tax split.
  supplier_gstin    text,
  recipient_gstin   text,
  place_of_supply   text,
  inter_state       boolean NOT NULL DEFAULT false,
  taxable_minor     bigint NOT NULL,
  tax_total_minor   bigint NOT NULL,
  round_off_minor   bigint NOT NULL DEFAULT 0,
  total_minor       bigint NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'INR',
  -- Line items + tax breakup as jsonb (the computed invoice).
  lines             jsonb NOT NULL,
  tax_lines         jsonb NOT NULL,
  -- IRN (Invoice Reference Number) from the GST e-invoice portal, when enabled.
  irn               text,
  original_invoice_id uuid REFERENCES invoices(id),  -- for credit notes
  issued_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, invoice_number)
);
CREATE INDEX invoices_booking_idx ON invoices (booking_id);

SELECT apply_tenant_rls('trip_charts');
SELECT apply_tenant_rls('invoice_series');
SELECT apply_tenant_rls('invoices');

-- migrate:down

DROP TABLE IF EXISTS invoices;
DROP TABLE IF EXISTS invoice_series;
DROP INDEX IF EXISTS refunds_working_idx;
ALTER TABLE refunds DROP COLUMN IF EXISTS cancellation_id;
ALTER TABLE refunds DROP COLUMN IF EXISTS failure_reason;
ALTER TABLE refunds DROP COLUMN IF EXISTS reconciled_at;
ALTER TABLE refunds DROP COLUMN IF EXISTS destination;
DROP TABLE IF EXISTS trip_charts;
