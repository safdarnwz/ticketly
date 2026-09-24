-- =============================================================================
-- 0020_platform_monetization
--
-- The platform's own revenue model, previously half-built:
--   1. Per-ticket commission (operator_commission, 0008) already existed but
--      was settable by the OPERATOR on THEMSELVES (POST /payments/commission,
--      tenant-scoped permission) — an operator could set their own platform
--      commission to 0%. This migration doesn't change that table's shape,
--      only who's allowed to write it (fixed at the application layer, see
--      TenantAdminController) and adds a real global default to fall back to
--      instead of a hard-coded 10%.
--   2. A ONE-TIME per-bus fee (₹4999 by default) — a single GLOBAL value the
--      super admin can raise/lower, applied UNIFORMLY to every operator (unlike
--      commission, which is negotiable per operator) — charged once per
--      vehicle registered, net-settled against the operator's payout.
-- =============================================================================

-- migrate:up

-- Simple global key-value store for platform-wide settings. jsonb value so a
-- new setting is a data change, not a migration.
CREATE TABLE platform_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO platform_settings (key, value) VALUES
  ('default_commission_percent', '1'::jsonb),   -- the 1% default the platform asked for
  ('per_bus_fee_minor', '499900'::jsonb)         -- ₹4999.00, one global value for every operator
ON CONFLICT (key) DO NOTHING;

-- One-time (or otherwise ad-hoc) platform charges against an operator, net-
-- settled against their payout in the next settlement run — the per-bus fee
-- is the first use, but this is general enough for future one-off platform
-- charges without another migration.
CREATE TABLE platform_charges (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind            text NOT NULL,               -- 'per_bus_fee' | future kinds
  reference_type  text,                        -- 'vehicle', for per_bus_fee
  reference_id    uuid,
  amount_minor    bigint NOT NULL,             -- snapshotted at charge time — a later
                                                -- rate change never rewrites past charges
  currency        char(3) NOT NULL DEFAULT 'INR',
  status          text NOT NULL DEFAULT 'pending',  -- 'pending' | 'settled' | 'waived'
  settlement_id   uuid REFERENCES settlements(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_charges_tenant_idx ON platform_charges (tenant_id, status);
CREATE UNIQUE INDEX platform_charges_dedupe_idx ON platform_charges (kind, reference_type, reference_id)
  WHERE reference_id IS NOT NULL;  -- a vehicle is only ever charged the per-bus fee once
SELECT apply_tenant_rls('platform_charges');

-- migrate:down

DROP TABLE IF EXISTS platform_charges;
DROP TABLE IF EXISTS platform_settings;
