-- =============================================================================
-- 0057_agent_commission_slabs
-- Volume-based agent commission. agent_id NULL = the operator's default table
-- for all its agents; a row set with agent_id = that agent's own table
-- (which takes precedence). Rate chosen by month-to-date net sales.
-- =============================================================================

-- migrate:up
CREATE TABLE agent_commission_slabs (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id               uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id                uuid REFERENCES agents(id) ON DELETE CASCADE,
  min_monthly_sales_minor bigint NOT NULL CHECK (min_monthly_sales_minor >= 0),
  commission_pct          numeric(5,2) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 50),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_commission_slabs_uq
  ON agent_commission_slabs (tenant_id, coalesce(agent_id, '00000000-0000-0000-0000-000000000000'::uuid), min_monthly_sales_minor);
SELECT apply_tenant_rls('agent_commission_slabs');

-- migrate:down
DROP TABLE IF EXISTS agent_commission_slabs;
