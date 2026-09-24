-- =============================================================================
-- 0049_agent_network
--
-- Re-introduces the B2B AGENT network (removed in 0034) — the core of a
-- MANTIS-style bus GDS: travel agents sell an operator's inventory to walk-in
-- customers and settle with the operator on account, not per ticket.
--
-- BILLING MODES
--   prepaid  — the agent deposits money with the operator up front and books
--              against that balance. credit_limit_minor is always 0.
--   postpaid — the agent books on credit up to credit_limit_minor and pays
--              the operator periodically against a statement.
--
-- ONE SIGNED BALANCE models both modes:
--   balance_minor > 0  → money the agent has on deposit with the operator
--   balance_minor < 0  → money the agent owes the operator (postpaid only)
--   spendable          = balance_minor + credit_limit_minor
-- The CHECK constraint `agents_spend_within_limit` makes overspending
-- impossible at the database level, whatever the application does — the
-- service's own friendly pre-check is only the first line of defence.
--
-- CASH LOCATION: an agent's money sits with the OPERATOR, never with the
-- platform's payment gateway. The platform ledger therefore books an agent
-- sale as "operator collected offline, owes the platform its commission"
-- (see ledger.ts offlineCaptureEntry) — it never pretends cash arrived in
-- gateway_clearing. The agent's own running account is agent_ledger below.
--
-- agent_ledger is APPEND-ONLY and idempotent per (agent, kind, reference):
-- a retried booking debit / refund credit can never hit the balance twice.
-- =============================================================================

-- migrate:up

CREATE TABLE agents (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The agent's login (a tenant staff user holding the 'agent' role).
  user_id               uuid NOT NULL REFERENCES users(id),
  code                  text NOT NULL,
  name                  text NOT NULL,
  contact_name          text,
  contact_phone         text NOT NULL,
  contact_email         text,
  gstin                 text,
  pan                   text,
  address               text,
  city                  text,
  branch_id             uuid REFERENCES branches(id),
  status                text NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'active', 'suspended', 'rejected')),
  billing_mode          text NOT NULL DEFAULT 'prepaid'
                          CHECK (billing_mode IN ('prepaid', 'postpaid')),
  -- Agent's commission on the NET fare (excluding GST), in percent.
  commission_pct        numeric(5,2) NOT NULL DEFAULT 5 CHECK (commission_pct >= 0 AND commission_pct <= 50),
  credit_limit_minor    bigint NOT NULL DEFAULT 0 CHECK (credit_limit_minor >= 0),
  balance_minor         bigint NOT NULL DEFAULT 0,
  low_balance_alert_minor bigint NOT NULL DEFAULT 0 CHECK (low_balance_alert_minor >= 0),
  -- Postpaid: days after a statement the agent has to pay it.
  payment_terms_days    integer NOT NULL DEFAULT 7 CHECK (payment_terms_days BETWEEN 0 AND 90),
  status_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agents_prepaid_no_credit CHECK (billing_mode = 'postpaid' OR credit_limit_minor = 0),
  CONSTRAINT agents_spend_within_limit CHECK (balance_minor + credit_limit_minor >= 0),
  UNIQUE (tenant_id, code),
  UNIQUE (tenant_id, user_id)
);
CREATE INDEX agents_tenant_status_idx ON agents (tenant_id, status);
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION set_updated_at();
SELECT apply_tenant_rls('agents');

CREATE TABLE agent_ledger (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  agent_id              uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind                  text NOT NULL CHECK (kind IN (
                          'deposit',             -- prepaid top-up received by the operator   (+)
                          'payment_received',    -- postpaid statement payment received        (+)
                          'booking_debit',       -- ticket sold: full ticket value             (-)
                          'commission_credit',   -- agent's commission on that ticket          (+)
                          'booking_reversal',    -- sale failed after debit: debit undone      (+)
                          'refund_credit',       -- cancellation refund back to the agent      (+)
                          'commission_reversal', -- commission clawed back on that refund      (-)
                          'adjustment'           -- manual correction by the operator          (+/-)
                        )),
  amount_minor          bigint NOT NULL CHECK (amount_minor <> 0),
  balance_after_minor   bigint NOT NULL,
  booking_id            uuid REFERENCES bookings(id),
  -- Idempotency key within (agent, kind): booking id, refund id, receipt no …
  reference             text,
  note                  text,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_ledger_agent_idx ON agent_ledger (agent_id, created_at DESC);
CREATE INDEX agent_ledger_booking_idx ON agent_ledger (booking_id) WHERE booking_id IS NOT NULL;
CREATE UNIQUE INDEX agent_ledger_idempotency_uq ON agent_ledger (agent_id, kind, reference) WHERE reference IS NOT NULL;
SELECT apply_tenant_rls('agent_ledger');

ALTER TABLE bookings ADD COLUMN agent_id uuid REFERENCES agents(id);
CREATE INDEX bookings_agent_idx ON bookings (tenant_id, agent_id) WHERE agent_id IS NOT NULL;

-- migrate:down

DROP INDEX IF EXISTS bookings_agent_idx;
ALTER TABLE bookings DROP COLUMN IF EXISTS agent_id;
DROP TABLE IF EXISTS agent_ledger;
DROP TABLE IF EXISTS agents;
