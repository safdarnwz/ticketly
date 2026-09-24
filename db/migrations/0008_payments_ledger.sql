-- =============================================================================
-- 0008_payments_ledger
--
-- Payment intents, the double-entry ledger, refunds, operator commission config
-- and settlements. The ledger is the financial source of truth: every money
-- movement is a balanced set of postings, and an operator's payable balance is
-- just the sum of their postings on the operator_payable account.
-- =============================================================================

-- migrate:up

-- ─────────────────────────────────────────────────────────────────────────────
-- payment_intents — one per attempt to pay for a booking. Idempotent on
-- (booking, intent) so a retried "pay" reuses the same PSP order.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TYPE payment_status AS ENUM ('created', 'authorized', 'captured', 'failed', 'refunded');

CREATE TABLE payment_intents (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  gateway           text NOT NULL,
  gateway_order_id  text,
  gateway_payment_id text,
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'INR',
  status            payment_status NOT NULL DEFAULT 'created',
  -- Raw gateway responses for audit / dispute resolution.
  metadata          jsonb NOT NULL DEFAULT '{}'::jsonb,
  captured_at       timestamptz,
  failed_reason     text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_intents_booking_idx ON payment_intents (booking_id);
CREATE UNIQUE INDEX payment_intents_order_idx ON payment_intents (gateway, gateway_order_id) WHERE gateway_order_id IS NOT NULL;
CREATE INDEX payment_intents_payment_idx ON payment_intents (gateway_payment_id) WHERE gateway_payment_id IS NOT NULL;
CREATE TRIGGER payment_intents_updated_at BEFORE UPDATE ON payment_intents FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- webhook_events — every received PSP webhook, deduplicated. A PSP delivers a
-- webhook AT LEAST once, so we store the provider event id with a unique
-- constraint and process each exactly once (the classic exactly-once-effect
-- pattern over at-least-once delivery).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE webhook_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid,
  gateway       text NOT NULL,
  event_id      text NOT NULL,               -- the PSP's event id
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  processed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (gateway, event_id)
);
CREATE INDEX webhook_events_unprocessed_idx ON webhook_events (created_at) WHERE processed_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- ledger_entries + ledger_postings — double-entry. An entry groups postings
-- that MUST net to zero (enforced by the application's LedgerTransaction and by
-- a deferred trigger here as a backstop).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE ledger_entries (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  entry_type    text NOT NULL,               -- 'booking.captured', 'refund.paid', ...
  currency      char(3) NOT NULL DEFAULT 'INR',
  source_type   text NOT NULL,
  source_id     text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_source_idx ON ledger_entries (tenant_id, source_type, source_id);

CREATE TABLE ledger_postings (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  entry_id      uuid NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account       text NOT NULL,
  -- Signed minor units: + debit, - credit. Sum over an entry MUST be zero.
  amount_minor  bigint NOT NULL,
  ref           text,                        -- operator id for per-operator balances
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_postings_entry_idx ON ledger_postings (entry_id);
-- The account-balance query: sum postings for an account (optionally per ref).
CREATE INDEX ledger_postings_account_idx ON ledger_postings (tenant_id, account, ref);

-- Backstop: a deferred constraint trigger that refuses to commit an entry whose
-- postings don't net to zero. The application already guarantees this; this is
-- defence in depth for the money layer.
CREATE OR REPLACE FUNCTION assert_ledger_balanced()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE net bigint;
BEGIN
  SELECT coalesce(sum(amount_minor), 0) INTO net FROM ledger_postings WHERE entry_id = NEW.entry_id;
  IF net <> 0 THEN
    RAISE EXCEPTION 'Ledger entry % does not balance (net=%)', NEW.entry_id, net;
  END IF;
  RETURN NULL;
END; $$;

CREATE CONSTRAINT TRIGGER ledger_balance_check
  AFTER INSERT ON ledger_postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- ─────────────────────────────────────────────────────────────────────────────
-- refunds — a refund record, tied to a booking's cancellation. Money movement
-- to the PSP is tracked here; the ledger records the accounting.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE refunds (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  booking_id        uuid NOT NULL REFERENCES bookings(id),
  payment_intent_id uuid REFERENCES payment_intents(id),
  amount_minor      bigint NOT NULL,
  currency          char(3) NOT NULL DEFAULT 'INR',
  status            text NOT NULL DEFAULT 'pending',  -- 'pending'|'processing'|'processed'|'failed'
  gateway_refund_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refunds_booking_idx ON refunds (booking_id);
CREATE TRIGGER refunds_updated_at BEFORE UPDATE ON refunds FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- operator_commission — per-operator (or per-route) commission config.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE operator_commission (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  route_id      uuid REFERENCES routes(id),          -- NULL = operator default
  model         text NOT NULL DEFAULT 'percent',     -- 'percent'|'flat'|'percent_plus'
  percent       numeric(5,2) DEFAULT 0,
  flat_minor    bigint DEFAULT 0,
  cap_minor     bigint,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, route_id)
);
CREATE TRIGGER operator_commission_updated_at BEFORE UPDATE ON operator_commission FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- settlements — a payout run: the accrued operator_payable settled to the
-- operator over a period.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE settlements (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  gross_minor   bigint NOT NULL DEFAULT 0,
  commission_minor bigint NOT NULL DEFAULT 0,
  refunds_minor bigint NOT NULL DEFAULT 0,
  net_minor     bigint NOT NULL DEFAULT 0,
  currency      char(3) NOT NULL DEFAULT 'INR',
  status        text NOT NULL DEFAULT 'draft',   -- 'draft'|'finalised'|'paid'
  booking_count integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX settlements_period_idx ON settlements (tenant_id, period_from, period_to);
CREATE TRIGGER settlements_updated_at BEFORE UPDATE ON settlements FOR EACH ROW EXECUTE FUNCTION set_updated_at();

SELECT apply_tenant_rls('payment_intents');
SELECT apply_tenant_rls('ledger_entries');
SELECT apply_tenant_rls('ledger_postings');
SELECT apply_tenant_rls('refunds');
SELECT apply_tenant_rls('operator_commission');
SELECT apply_tenant_rls('settlements');
-- webhook_events has a nullable tenant (some webhooks arrive before we resolve
-- the tenant); it uses a bypass-aware policy so the payment module can write it.
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_policy ON webhook_events
  USING (rls_bypass_enabled() OR tenant_id IS NOT DISTINCT FROM current_tenant_id() OR tenant_id IS NULL)
  WITH CHECK (rls_bypass_enabled() OR tenant_id IS NOT DISTINCT FROM current_tenant_id() OR tenant_id IS NULL);

-- migrate:down

DROP TABLE IF EXISTS settlements;
DROP TABLE IF EXISTS operator_commission;
DROP TABLE IF EXISTS refunds;
DROP TABLE IF EXISTS ledger_postings;
DROP TABLE IF EXISTS ledger_entries;
DROP FUNCTION IF EXISTS assert_ledger_balanced();
DROP TABLE IF EXISTS webhook_events;
DROP TABLE IF EXISTS payment_intents;
DROP TYPE IF EXISTS payment_status;
