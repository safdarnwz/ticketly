-- =============================================================================
-- 0025_payout_disbursement
--
-- Settlement (ledger: "operator_payable → operator_wallet") answers "how much
-- do we owe this operator, as of when" — it says NOTHING about whether the
-- money has actually LEFT the platform's bank account into the operator's.
-- That's a genuinely separate concern (disbursement), and conflating them is
-- exactly how a platform ends up claiming "paid" when a bank transfer never
-- actually happened.
--
-- This adds:
--   1. Operator bank account details (needed to pay anyone at all).
--   2. `payout_instructions` — one row per settlement, the DISBURSEMENT
--      side. Snapshots the bank details AT INSTRUCTION TIME (an operator
--      changing their bank account later must never rewrite a past,
--      possibly-already-sent instruction).
-- =============================================================================

-- migrate:up

ALTER TABLE tenants ADD COLUMN bank_account_holder text;
ALTER TABLE tenants ADD COLUMN bank_account_number text;
ALTER TABLE tenants ADD COLUMN bank_ifsc text;
ALTER TABLE tenants ADD COLUMN bank_name text;
ALTER TABLE tenants ADD COLUMN bank_details_updated_at timestamptz;

CREATE TABLE payout_instructions (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id             uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  settlement_id         uuid NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  amount_minor          bigint NOT NULL,
  currency              char(3) NOT NULL DEFAULT 'INR',
  -- Snapshotted at creation — NEVER re-read from tenants at send/confirm time.
  beneficiary_name      text NOT NULL,
  bank_account_number   text NOT NULL,
  bank_ifsc             text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',  -- 'pending' | 'in_batch' | 'sent' | 'confirmed' | 'failed'
  batch_id              uuid,
  sent_at               timestamptz,
  confirmed_at          timestamptz,
  failure_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payout_instructions_settlement_idx ON payout_instructions (settlement_id);
CREATE INDEX payout_instructions_status_idx ON payout_instructions (status, created_at);
SELECT apply_tenant_rls('payout_instructions');

-- migrate:down

DROP TABLE IF EXISTS payout_instructions;
ALTER TABLE tenants DROP COLUMN IF EXISTS bank_details_updated_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS bank_name;
ALTER TABLE tenants DROP COLUMN IF EXISTS bank_ifsc;
ALTER TABLE tenants DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE tenants DROP COLUMN IF EXISTS bank_account_holder;
