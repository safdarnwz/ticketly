-- =============================================================================
-- 0063_passenger_categories
-- Passenger categories & concessions (senior / student / defence / child /
-- disabled), the operator's passenger policy (adult age, infant age & fee,
-- unaccompanied minors) and lap infants (no seat). See
-- booking/domain/passenger-categories.ts for the rules.
-- =============================================================================

-- migrate:up
CREATE TABLE concession_rules (
  tenant_id          uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category           text NOT NULL CHECK (category IN ('child', 'senior', 'student', 'defence', 'disabled')),
  discount_pct       numeric(5,2) NOT NULL CHECK (discount_pct BETWEEN 0 AND 100),
  min_age            smallint CHECK (min_age IS NULL OR min_age BETWEEN 0 AND 120),
  max_age            smallint CHECK (max_age IS NULL OR max_age BETWEEN 0 AND 120),
  requires_id_proof  boolean NOT NULL DEFAULT false,
  valid_from         date,
  valid_to           date,
  max_per_booking    smallint CHECK (max_per_booking IS NULL OR max_per_booking BETWEEN 1 AND 10),
  active             boolean NOT NULL DEFAULT true,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, category),
  CONSTRAINT concession_age_band CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age),
  CONSTRAINT concession_window CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
SELECT apply_tenant_rls('concession_rules');

CREATE TABLE passenger_policies (
  tenant_id                   uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  adult_age                   smallint NOT NULL DEFAULT 18 CHECK (adult_age BETWEEN 12 AND 21),
  infant_max_age              smallint NOT NULL DEFAULT 5 CHECK (infant_max_age BETWEEN 1 AND 6),
  infant_fee_minor            bigint NOT NULL DEFAULT 0 CHECK (infant_fee_minor >= 0),
  allow_unaccompanied_minors  boolean NOT NULL DEFAULT false,
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
SELECT apply_tenant_rls('passenger_policies');

ALTER TABLE passengers ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'adult'
  CHECK (category IN ('adult', 'child', 'senior', 'student', 'defence', 'disabled'));
ALTER TABLE passengers ADD COLUMN IF NOT EXISTS id_proof text CHECK (id_proof IS NULL OR length(id_proof) <= 40);

CREATE TABLE booking_infants (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  booking_id     uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name      text NOT NULL,
  age            smallint NOT NULL CHECK (age BETWEEN 0 AND 6),
  guardian_seat  text NOT NULL,
  fee_minor      bigint NOT NULL DEFAULT 0 CHECK (fee_minor >= 0)
);
CREATE INDEX booking_infants_booking_idx ON booking_infants (booking_id);
SELECT apply_tenant_rls('booking_infants');

-- migrate:down
DROP TABLE IF EXISTS booking_infants;
ALTER TABLE passengers DROP COLUMN IF EXISTS id_proof;
ALTER TABLE passengers DROP COLUMN IF EXISTS category;
DROP TABLE IF EXISTS passenger_policies;
DROP TABLE IF EXISTS concession_rules;
