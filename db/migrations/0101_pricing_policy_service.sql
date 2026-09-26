-- migrate:up
-- 0101_pricing_policy_service
-- A dynamic-pricing (yield) policy can now be set for one service — e.g. the
-- popular 21:30 departure — and wins over its route's policy, which wins over
-- the operator-wide one. A policy targets a route OR a service, never both.
ALTER TABLE pricing_policies ADD COLUMN service_id uuid REFERENCES services(id);
ALTER TABLE pricing_policies ADD CONSTRAINT pricing_policies_one_scope
  CHECK (route_id IS NULL OR service_id IS NULL);
DROP INDEX IF EXISTS pricing_policies_one_active;
CREATE UNIQUE INDEX pricing_policies_one_active
  ON pricing_policies (tenant_id, route_id, service_id) NULLS NOT DISTINCT WHERE is_active;
CREATE INDEX pricing_policies_service_idx ON pricing_policies (tenant_id, service_id)
  WHERE is_active AND service_id IS NOT NULL;

-- migrate:down
DROP INDEX IF EXISTS pricing_policies_service_idx;
UPDATE pricing_policies SET is_active = false WHERE service_id IS NOT NULL;
DROP INDEX IF EXISTS pricing_policies_one_active;
CREATE UNIQUE INDEX pricing_policies_one_active
  ON pricing_policies (tenant_id, route_id) NULLS NOT DISTINCT WHERE is_active;
ALTER TABLE pricing_policies DROP CONSTRAINT IF EXISTS pricing_policies_one_scope;
ALTER TABLE pricing_policies DROP COLUMN IF EXISTS service_id;
