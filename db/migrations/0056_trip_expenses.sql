-- =============================================================================
-- 0056_trip_expenses
-- Running costs of a trip (diesel, toll, driver bata, ...) for trip / route /
-- bus profit & loss. Rows are never deleted: a wrong entry is VOIDED with a
-- reason, so the books keep an audit trail of every change.
-- =============================================================================

-- migrate:up
CREATE TABLE trip_expenses (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  trip_id          uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  category         text NOT NULL CHECK (category IN ('diesel','cng','toll','driver_bata','cleaner_bata','parking','permit_fee','state_tax','repair','food','cleaning','other')),
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0 AND amount_minor <= 50000000),
  note             text CHECK (note IS NULL OR length(note) <= 300),
  receipt_file_id  uuid REFERENCES stored_files(id),
  incurred_at      timestamptz NOT NULL DEFAULT now(),
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  voided_at        timestamptz,
  void_reason      text,
  voided_by        uuid REFERENCES users(id),
  CONSTRAINT trip_expenses_void_reason CHECK (voided_at IS NULL OR length(coalesce(void_reason, '')) >= 5)
);
CREATE INDEX trip_expenses_trip_idx ON trip_expenses (trip_id) WHERE voided_at IS NULL;
SELECT apply_tenant_rls('trip_expenses');

-- migrate:down
DROP TABLE IF EXISTS trip_expenses;
