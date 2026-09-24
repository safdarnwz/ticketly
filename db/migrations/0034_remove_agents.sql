-- =============================================================================
-- 0034_remove_agents
--
-- The Agent (B2B sub-distributor) feature has been removed from the product
-- entirely, per product decision — may be revisited in the future. All
-- application code paths (PaymentService.chargeFromAgentWallet, the agent
-- gateway in RefundService, the agents module itself) have already been
-- removed; this drops the now-unused schema cleanly. bookings.agent_id is
-- dropped along with its index; coupons.agent_only is dropped since the
-- concept it targeted no longer exists.
-- =============================================================================

-- migrate:up

DROP INDEX IF EXISTS bookings_agent_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS agent_id;
ALTER TABLE coupons DROP COLUMN IF EXISTS agent_only;
DROP TABLE IF EXISTS agent_wallet_ledger;
DROP TABLE IF EXISTS agents;

-- migrate:down

CREATE TABLE agents (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id),
  name            text NOT NULL,
  contact_phone   text NOT NULL,
  contact_email   text,
  status          text NOT NULL DEFAULT 'pending',
  commission_pct  numeric(5,2) NOT NULL DEFAULT 5,
  wallet_balance_minor bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_tenant_status_idx ON agents (tenant_id, status);
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('agents');

CREATE TABLE agent_wallet_ledger (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind            text NOT NULL,
  amount_minor    bigint NOT NULL,
  balance_after_minor bigint NOT NULL,
  reference_type  text,
  reference_id    uuid,
  note            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_wallet_ledger_agent_idx ON agent_wallet_ledger (agent_id, created_at DESC);
SELECT apply_tenant_rls('agent_wallet_ledger');

ALTER TABLE bookings ADD COLUMN agent_id uuid REFERENCES agents(id);
CREATE INDEX bookings_agent_idx ON bookings (tenant_id, agent_id) WHERE agent_id IS NOT NULL;
ALTER TABLE coupons ADD COLUMN agent_only boolean NOT NULL DEFAULT false;
