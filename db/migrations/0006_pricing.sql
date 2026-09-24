-- =============================================================================
-- 0006_pricing
--
-- Fare plans (base fares per segment/seat-class), dynamic-pricing (yield)
-- policies, coupons, and tax policies. Search (Part 6) resolves a base fare
-- from these, then the PricingEngine applies yield + coupon + GST to produce an
-- auditable breakup. Booking (Part 7) re-prices at confirm time against a
-- short-lived quote so the price the passenger saw is the price they pay.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- fare_plans — a named set of base fares for a route. A service references a
-- fare plan (via its route); versioning lets an operator prepare next season's
-- fares without disturbing the live ones.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE fare_plan_status AS ENUM ('draft', 'active', 'archived');

CREATE TABLE fare_plans (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id      uuid NOT NULL REFERENCES routes(id),
  name          text NOT NULL,
  currency      char(3) NOT NULL DEFAULT 'INR',
  status        fare_plan_status NOT NULL DEFAULT 'draft',
  -- Effective window; the active plan whose window covers the journey date wins.
  effective_from date,
  effective_to   date,
  version       integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX fare_plans_route_idx ON fare_plans (tenant_id, route_id, status) WHERE deleted_at IS NULL;
CREATE TRIGGER fare_plans_updated_at BEFORE UPDATE ON fare_plans FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- fare_rules — base fare for a (from_stop, to_stop, seat_type) within a plan.
-- The segment fare is looked up by the exact boarding/dropping pair, falling
-- back to distance-proportional pricing when a specific pair is not defined.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE fare_rules (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  fare_plan_id  uuid NOT NULL REFERENCES fare_plans(id) ON DELETE CASCADE,
  from_stop_id  uuid REFERENCES stops(id),           -- NULL = any origin (fallback)
  to_stop_id    uuid REFERENCES stops(id),           -- NULL = any destination
  seat_type     text NOT NULL DEFAULT 'seater',
  base_fare_minor bigint NOT NULL,
  -- Optional per-km rate used when no exact segment fare exists.
  per_km_minor  bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fare_plan_id, from_stop_id, to_stop_id, seat_type)
);
CREATE INDEX fare_rules_lookup_idx ON fare_rules (fare_plan_id, from_stop_id, to_stop_id, seat_type);

-- ─────────────────────────────────────────────────────────────────────────────
-- pricing_policies — the dynamic-pricing (yield) ladder, as jsonb (occupancy
-- steps, advance-purchase curve, min/max multiplier). Attached to a route or
-- applied tenant-wide. Validated by the PricingEngine's YieldLadder type.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE pricing_policies (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id      uuid REFERENCES routes(id),           -- NULL = tenant default
  name          text NOT NULL,
  ladder        jsonb NOT NULL,
  is_active     boolean NOT NULL DEFAULT true,
  gst_rate_pct  numeric(5,2) NOT NULL DEFAULT 5,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pricing_policies_route_idx ON pricing_policies (tenant_id, route_id) WHERE is_active;
CREATE TRIGGER pricing_policies_updated_at BEFORE UPDATE ON pricing_policies FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- coupons — discount codes. Validity window, usage cap, and per-user cap. The
-- usage counter is incremented atomically at booking time (Part 7).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE coupons (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            text NOT NULL,
  kind            text NOT NULL,               -- 'percent' | 'flat'
  value           bigint NOT NULL,             -- pct (0..100) or flat minor units
  max_discount_minor bigint,
  min_fare_minor  bigint,
  valid_from      timestamptz,
  valid_to        timestamptz,
  -- Usage limits. usage_count is bumped with an atomic conditional UPDATE.
  max_redemptions integer,
  usage_count     integer NOT NULL DEFAULT 0,
  per_user_limit  integer,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);
CREATE INDEX coupons_code_idx ON coupons (tenant_id, code) WHERE is_active;
CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('fare_plans');
SELECT apply_tenant_rls('fare_rules');
SELECT apply_tenant_rls('pricing_policies');
SELECT apply_tenant_rls('coupons');

COMMENT ON CONSTRAINT coupons_tenant_id_code_key ON coupons IS 'A coupon with this code already exists';

-- migrate:down

DROP TABLE IF EXISTS coupons;
DROP TABLE IF EXISTS pricing_policies;
DROP TABLE IF EXISTS fare_rules;
DROP TABLE IF EXISTS fare_plans;
DROP TYPE IF EXISTS fare_plan_status;
