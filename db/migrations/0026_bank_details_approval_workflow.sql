-- =============================================================================
-- 0026_bank_details_approval_workflow
--
-- Two changes:
--   1. Bank details are now captured AT ONBOARDING (operator_applications) —
--      the account vetted as part of the whole application review becomes
--      the tenant's initial, ACTIVE payout account the moment they're
--      approved. No separate step, no window where an approved operator has
--      no account on file.
--   2. Any LATER change to bank details is no longer applied directly —
--      it's a request, sitting in `bank_account_change_requests` as
--      'pending' until the platform explicitly approves it. The account
--      actually used for scheduled payouts (`tenants.bank_account_*`) is
--      untouched until that approval happens. This is a standard anti-fraud
--      control: if an operator's console login were ever compromised, an
--      attacker changing the payout account should NOT be able to redirect
--      money on their own — a human on the platform side has to look at it.
-- =============================================================================

-- migrate:up

ALTER TABLE operator_applications ADD COLUMN bank_account_holder text;
ALTER TABLE operator_applications ADD COLUMN bank_account_number text;
ALTER TABLE operator_applications ADD COLUMN bank_ifsc text;
ALTER TABLE operator_applications ADD COLUMN bank_name text;

CREATE TABLE bank_account_change_requests (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_holder      text NOT NULL,
  account_number      text NOT NULL,
  ifsc                text NOT NULL,
  bank_name           text,
  status              text NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'rejected'
  submitted_by        uuid REFERENCES users(id),
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  rejection_reason    text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bank_account_change_requests_tenant_idx ON bank_account_change_requests (tenant_id, status);
-- Only one PENDING request per operator at a time — a second submission
-- while one is already under review should replace it, not queue behind it
-- (see PayoutRepository.submitBankChangeRequest, which supersedes on conflict).
CREATE UNIQUE INDEX bank_account_change_requests_one_pending_idx ON bank_account_change_requests (tenant_id) WHERE status = 'pending';
SELECT apply_tenant_rls('bank_account_change_requests');

-- migrate:down

DROP TABLE IF EXISTS bank_account_change_requests;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS bank_name;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS bank_ifsc;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS bank_account_number;
ALTER TABLE operator_applications DROP COLUMN IF EXISTS bank_account_holder;
