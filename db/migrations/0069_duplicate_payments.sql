-- =============================================================================
-- 0069_duplicate_payments
-- A booking can be paid twice (UPI retry, two tabs, gateway replay). The
-- second capture used to be ignored silently — the customer was charged twice
-- and never refunded. Every extra capture is now recorded here and refunded
-- in full automatically. gateway_payment_id is UNIQUE so a redelivered
-- webhook can never refund twice.
-- =============================================================================

-- migrate:up
CREATE TABLE duplicate_payments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v7(),
  tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  intent_id           uuid NOT NULL REFERENCES payment_intents(id),
  booking_id          uuid NOT NULL REFERENCES bookings(id),
  gateway             text NOT NULL,
  gateway_payment_id  text NOT NULL,
  amount_minor        bigint NOT NULL CHECK (amount_minor >= 0),
  status              text NOT NULL DEFAULT 'refund_pending' CHECK (status IN ('refund_pending', 'refunded', 'refund_failed')),
  gateway_refund_id   text,
  failure_reason      text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicate_payments_gpid_uq UNIQUE (gateway, gateway_payment_id)
);
CREATE INDEX duplicate_payments_pending_idx ON duplicate_payments (created_at) WHERE status <> 'refunded';
SELECT apply_tenant_rls('duplicate_payments');

-- migrate:down
DROP TABLE IF EXISTS duplicate_payments;
