-- =============================================================================
-- 0028_agents
--
-- Travel agents — the B2B distribution channel where a local agency books on
-- behalf of walk-in customers using a PREPAID WALLET (they've already paid the
-- operator offline/cash) and earn a commission (a cut of the fare, which they
-- keep from what they collected off the walk-in customer — it never even
-- enters the operator's books, same as any other channel's commission never
-- entering the CUSTOMER's).
--
-- Money model (deliberately simple, reusing the EXISTING capture ledger
-- unchanged): an agent's wallet is debited NET of their own commission
-- (fare − agentCommission) — from the operator's perspective this net amount
-- IS "what was collected" for this booking, and platform commission/GST are
-- computed off THAT, exactly like any other channel. No new ledger accounts
-- needed; PaymentService.chargeFromAgentWallet is just onCaptured() with a
-- different "how the money arrived" amount.
--
-- An agent is a real user (kind='staff', a normal login) — `agents` holds the
-- wallet/commission specifics a plain staff user doesn't have.
-- =============================================================================

-- migrate:up

CREATE TABLE agents (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         uuid REFERENCES users(id),          -- their login, once one exists
  name            text NOT NULL,
  contact_phone   text NOT NULL,
  contact_email   text,
  status          text NOT NULL DEFAULT 'pending',    -- 'pending' | 'active' | 'suspended' | 'rejected'
  commission_pct  numeric(5,2) NOT NULL DEFAULT 5,     -- % of fare the agent keeps
  wallet_balance_minor bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agents_tenant_status_idx ON agents (tenant_id, status);
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('agents');

-- Append-only audit trail for the wallet — every top-up and every booking
-- debit, with the running balance so a discrepancy is instantly spottable
-- (sum of deltas must equal the latest balance_after).
CREATE TABLE agent_wallet_ledger (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id        uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind            text NOT NULL,          -- 'topup' | 'booking_debit' | 'refund_credit'
  amount_minor    bigint NOT NULL,        -- positive = credit, negative = debit
  balance_after_minor bigint NOT NULL,
  reference_type  text,                   -- 'booking', for booking_debit/refund_credit
  reference_id    uuid,
  note            text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_wallet_ledger_agent_idx ON agent_wallet_ledger (agent_id, created_at DESC);
SELECT apply_tenant_rls('agent_wallet_ledger');

-- Bookings need to know which agent (if any) made them, for reporting and to
-- find the right wallet to debit/credit on cancellation.
ALTER TABLE bookings ADD COLUMN agent_id uuid REFERENCES agents(id);
CREATE INDEX bookings_agent_idx ON bookings (tenant_id, agent_id) WHERE agent_id IS NOT NULL;

-- migrate:down

ALTER TABLE bookings DROP COLUMN IF EXISTS agent_id;
DROP TABLE IF EXISTS agent_wallet_ledger;
DROP TABLE IF EXISTS agents;
